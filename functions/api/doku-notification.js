// Webhook (notifikasi) DOKU Checkout.
// Tugas: verifikasi signature -> baca status -> simpan (idempoten) -> balas 200 cepat.

const MAX_BODY_BYTES = 256 * 1024;
const TOLERANSI_DETIK = 600; // toleransi clock skew / retry DOKU

/* ---------------- util ---------------- */

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function sha256Base64(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64(buf);
}

async function hmacSha256Base64(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// perbandingan constant-time, bukan `===`
function samaPersis(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const balas = (pesan, status = 200) =>
  new Response(pesan, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/* ---------------- verifikasi ---------------- */

async function verifikasi({ request, raw, secretKey }) {
  const h = (k) => request.headers.get(k) ?? "";

  const clientId = h("Client-Id");
  const requestId = h("Request-Id");
  const timestamp = h("Request-Timestamp");
  const target = h("Request-Target");
  const digestHeader = h("Digest");
  const signatureHeader = h("Signature");

  if (!signatureHeader) {
    return { ok: false, reason: "header Signature tidak ada" };
  }
  if (!clientId || !requestId || !timestamp || !target || !digestHeader) {
    return { ok: false, reason: "header wajib tidak lengkap" };
  }

  // 1. Digest dihitung dari BODY MENTAH, bukan hasil JSON.stringify ulang
  const digest = await sha256Base64(raw);
  if (!samaPersis(digest, digestHeader)) {
    return { ok: false, reason: "digest tidak cocok" };
  }

  // 2. Susun komponen signature dari nilai header APA ADANYA
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${target}`,
    `Digest:${digest}`,
  ].join("\n");

  const expected = `HMACSHA256=${await hmacSha256Base64(secretKey, component)}`;
  if (!samaPersis(expected, signatureHeader)) {
    return { ok: false, reason: "signature tidak cocok" };
  }

  // 3. Catat (jangan tolak) kalau Request-Target beda dari path sebenarnya,
  //    karena Pages bisa menormalkan trailing slash.
  const pathname = new URL(request.url).pathname;
  if (target !== pathname) {
    console.warn("Request-Target beda dari pathname:", { target, pathname });
  }

  // 4. Cek kesegaran timestamp (hanya peringatan, tidak menolak)
  const umurDetik = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000;
  if (!Number.isFinite(umurDetik) || umurDetik > TOLERANSI_DETIK) {
    console.warn("Timestamp notifikasi jauh dari sekarang:", { timestamp, umurDetik });
  }

  return { ok: true, digest, requestId };
}

/* ---------------- helper data ---------------- */

// Ambil field penting dari payload yang bentuknya beda-beda per channel.
function bacaNotifikasi(payload) {
  const invoice =
    payload?.order?.invoice_number ??
    payload?.order?.invoiceNumber ??
    payload?.invoice_number ??
    null;

  const status =
    payload?.transaction?.status ??
    payload?.payment?.status ??
    payload?.status ??
    null;

  const amount =
    payload?.order?.amount ??
    payload?.transaction?.amount ??
    payload?.amount ??
    null;

  const channel =
    payload?.channel?.id ??
    payload?.service?.id ??
    payload?.acquirer?.id ??
    null;

  return {
    invoice,
    status: status ? String(status).toUpperCase() : null,
    amount: amount === null ? null : Number(amount),
    channel,
    waktu: payload?.transaction?.date ?? payload?.payment?.date ?? null,
  };
}

/* ---------------- handler ---------------- */

export async function onRequestPost({ request, env }) {
  const secretKey = env.DOKU_SECRET_KEY;
  if (!secretKey) {
    console.error("DOKU_SECRET_KEY belum diset");
    return balas("server misconfigured", 500);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return balas("payload terlalu besar", 413);
  }

  let raw;
  try {
    raw = await request.text(); // dibaca SEKALI, dipakai untuk digest & parsing
  } catch (e) {
    console.error("Gagal membaca body", e);
    return balas("bad request", 400);
  }

  if (!raw) return balas("body kosong", 400);

  const hasil = await verifikasi({ request, raw, secretKey });
  if (!hasil.ok) {
    console.error("Notifikasi ditolak:", hasil.reason);
    return balas("forbidden", 401);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error("Body bukan JSON valid");
    return balas("bad request", 400);
  }

  const notif = bacaNotifikasi(payload);
  if (!notif.invoice) {
    console.error("invoice_number tidak ditemukan", raw.slice(0, 500));
    // tetap 200 supaya DOKU tidak retry tanpa henti
    return balas("ok", 200);
  }

  console.log("Notif DOKU", {
    invoice: notif.invoice,
    status: notif.status,
    amount: notif.amount,
    channel: notif.channel,
    requestId: hasil.requestId,
  });

  // Kalau belum ada binding KV, berhenti di sini (hanya log)
  const kv = env.ORDERS;
  if (!kv) {
    console.warn("Binding KV ORDERS belum ada — status tidak disimpan");
    return balas("ok", 200);
  }

  const key = `order:${notif.invoice}`;

  let order = null;
  try {
    order = await kv.get(key, "json");
  } catch (e) {
    console.error("Gagal membaca KV", e);
    return balas("internal error", 500); // biar DOKU retry
  }

  if (!order) {
    console.error("Order tidak dikenal:", notif.invoice);
    return balas("ok", 200);
  }

  // Jangan percaya amount dari notifikasi
  if (notif.amount !== null && Number(order.amount) !== notif.amount) {
    console.error("AMOUNT TIDAK COCOK", {
      invoice: notif.invoice,
      tercatat: order.amount,
      dariDoku: notif.amount,
    });
    return balas("ok", 200);
  }

  // Idempoten: jangan turunkan status yang sudah final
  const final = new Set(["SUCCESS", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]);
  if (final.has(order.status) && order.status !== notif.status) {
    console.warn("Status final sudah ada, diabaikan", {
      invoice: notif.invoice,
      lama: order.status,
      baru: notif.status,
    });
    return balas("ok", 200);
  }

  const updated = {
    ...order,
    status: notif.status,
    channel: notif.channel ?? order.channel ?? null,
    paidAt: notif.status === "SUCCESS" ? new Date().toISOString() : order.paidAt ?? null,
    updatedAt: new Date().toISOString(),
    lastRequestId: hasil.requestId,
    lastNotif: payload,
  };

  try {
    await kv.put(key, JSON.stringify(updated));
  } catch (e) {
    console.error("Gagal menulis KV", e);
    return balas("internal error", 500); // DOKU akan retry
  }

  console.log("Order diperbarui", { invoice: notif.invoice, status: notif.status });
  return balas("ok", 200);
}

export async function onRequest({ request }) {
  return balas(`Metode ${request.method} tidak didukung`, 405);
}
