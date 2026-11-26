// Verifikasi notifikasi DOKU Checkout & perbarui status order di KV.
// Skema signature: Client-Id + Request-Id + Request-Timestamp + Request-Target(path) + Digest(body).
// PENTING: pakai header `Signature` dan `Request-Timestamp`. Header `X-Signature`/`X-Timestamp`
// bisa basi pada retry sehingga tidak bisa dipakai.

const MAX_BODY_BYTES = 512 * 1024;
const ORDER_TTL_DETIK = 60 * 60 * 24 * 30;
const UMUR_MAKS_DETIK = 3600; // toleransi timestamp notifikasi

const enc = new TextEncoder();

/* ---------------- util ---------------- */

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function sha256B64(text) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hmacB64(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function samaPersis(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const balas = (pesan, status = 200) =>
  new Response(pesan, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/* ---------------- pembacaan payload ---------------- */

function bacaNotifikasi(p) {
  return {
    invoice: p?.order?.invoice_number ?? null,
    amount: p?.order?.amount == null ? null : Number(p.order.amount),
    status: p?.transaction?.status ? String(p.transaction.status).toUpperCase() : null,
    waktu: p?.transaction?.date ?? null,
    channel: p?.channel?.id ?? p?.service?.id ?? null,
    acquirer: p?.acquirer?.id ?? null,
  };
}

/* ---------------- handler ---------------- */

export async function onRequestPost({ request, env }) {
  const secret = env.DOKU_SECRET_KEY;
  const clientIdEnv = env.DOKU_CLIENT_ID;
  const kv = env.ORDERS;

  if (!secret || !clientIdEnv || !kv) {
    console.error("Konfigurasi belum lengkap", {
      secret: !!secret, clientId: !!clientIdEnv, kv: !!kv,
    });
    return balas("server misconfigured", 500);
  }

  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return balas("payload terlalu besar", 413);
  }

  // body dibaca SEKALI — dipakai untuk digest dan untuk parsing
  const raw = await request.text();
  if (!raw) return balas("body kosong", 400);

  const h = (k) => request.headers.get(k) ?? "";
  const clientId = h("client-id");
  const requestId = h("request-id");
  const timestamp = h("request-timestamp");
  const signature = h("signature");

  if (!clientId || !requestId || !timestamp || !signature) {
    console.error("Header wajib tidak lengkap", { clientId: !!clientId, requestId: !!requestId, timestamp: !!timestamp, signature: !!signature });
    return balas("forbidden", 401);
  }

  if (clientId !== clientIdEnv) {
    console.error("Client-Id tidak cocok dengan milik kita", { dariDoku: clientId });
    return balas("forbidden", 401);
  }

  // Request-Target = pathname, tanpa query, tanpa trailing slash tambahan
  const target = new URL(request.url).pathname;
  const digest = await sha256B64(raw);

  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${target}`,
    `Digest:${digest}`,
  ].join("\n");

  const expected = `HMACSHA256=${await hmacB64(secret, component)}`;
  if (!samaPersis(expected, signature)) {
    console.error("Signature tidak cocok", { requestId, target });
    return balas("forbidden", 401);
  }

  const umur = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000;
  if (!Number.isFinite(umur) || umur > UMUR_MAKS_DETIK) {
    console.warn("Timestamp notifikasi di luar toleransi (diproses tetap)", { timestamp, umurDetik: Math.round(umur) });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error("Body bukan JSON", raw.slice(0, 300));
    return balas("bad request", 400);
  }

  const n = bacaNotifikasi(payload);
  if (!n.invoice) {
    console.error("invoice_number tidak ada di payload", raw.slice(0, 300));
    return balas("ok", 200); // tidak akan membaik dengan retry
  }

  const key = `order:${n.invoice}`;
  const order = await kv.get(key, "json");

  if (!order) {
    // 503 supaya DOKU retry: KV Cloudflare eventually consistent (±60 detik),
    // jadi bisa saja order baru ditulis dan belum terbaca di colo ini.
    console.error("Order tidak ditemukan — minta retry", { invoice: n.invoice, requestId });
    return balas("retry later", 503);
  }

  if (n.amount !== null && Number(order.amount) !== n.amount) {
    console.error("AMOUNT TIDAK COCOK", {
      invoice: n.invoice, tersimpan: order.amount, dariDoku: n.amount,
    });
    return balas("ok", 200);
  }

  const FINAL = ["SUCCESS", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"];
  if (FINAL.includes(order.status) && order.status !== n.status) {
    console.warn("Status final sudah tercatat, notifikasi diabaikan", {
      invoice: n.invoice, lama: order.status, baru: n.status,
    });
    return balas("ok", 200);
  }

  const updated = {
    ...order,
    status: n.status,
    channel: n.channel ?? order.channel ?? null,
    acquirer: n.acquirer ?? order.acquirer ?? null,
    paidAt: n.status === "SUCCESS" ? (order.paidAt ?? n.waktu ?? new Date().toISOString()) : (order.paidAt ?? null),
    updatedAt: new Date().toISOString(),
    lastRequestId: requestId,
    lastNotifAt: n.waktu,
  };

  try {
    await kv.put(key, JSON.stringify(updated), { expirationTtl: ORDER_TTL_DETIK });
  } catch (e) {
    console.error("Gagal menulis KV — minta retry", { invoice: n.invoice, err: String(e) });
    return balas("retry later", 503);
  }

  console.log("Order diperbarui", { invoice: n.invoice, status: n.status, channel: n.channel });
  return balas("ok", 200);
}

export async function onRequest({ request }) {
  return balas(`Metode ${request.method} tidak didukung`, 405);
}
