// Membuat transaksi DOKU Checkout, menyimpan order ke KV, mengembalikan paymentUrl.
// Harga TIDAK PERNAH diambil dari client — selalu dari katalog di server.

const TARGET_PATH = "/checkout/v1/payment";
const MAX_BODY_BYTES = 8 * 1024;
const ORDER_TTL_DETIK = 60 * 60 * 24 * 30; // 30 hari

/* ---------------- util ---------------- */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

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

function urlAman(nilai) {
  if (!nilai) return "(kosong)";
  try {
    const u = new URL(nilai);
    return `${u.origin}${u.pathname}`;
  } catch {
    return `(tidak valid: ${String(nilai).slice(0, 60)})`;
  }
}

/* ---------------- katalog ---------------- */

async function ambilProduk(request, env, id) {
  const url = new URL("/data/produk.json", request.url);

  let res;
  if (env.ASSETS?.fetch) {
    res = await env.ASSETS.fetch(new URL(url.pathname, url.origin));
  } else {
    res = await fetch(url);
  }
  if (!res.ok) {
    console.error("Katalog tidak bisa dibaca", { status: res.status });
    return { error: "Katalog tidak tersedia", status: 500 };
  }

  const list = await res.json();
  const produk = list.find((p) => p?.id === id);
  if (!produk) return { error: "Produk tidak ditemukan", status: 404 };

  // Struktur sudah pasti: harga = integer
  const harga = produk.harga;
  if (!Number.isInteger(harga) || harga <= 0) {
    console.error("Harga tidak valid", { id, harga });
    return { error: "Harga produk tidak valid", status: 500 };
  }

  if (produk.stok === false) {
    return { error: "Produk sedang tidak tersedia", status: 409 };
  }

  return {
    produk: {
      id: produk.id,
      nama: produk.nama,
      harga,
      label: buatLabel(produk), // untuk line_items DOKU
    },
  };
}

// Nama produk di katalog banyak yang identik, jadi invoice perlu pembeda
function buatLabel(p) {
  if (p.kategori === "velg") {
    const bit = [];
    if (p.ukuran) bit.push(`${p.ukuran}"`);
    if (p.pcd) bit.push(p.pcd);
    if (p.offset) bit.push(p.offset);
    return bit.length ? `${p.nama} (${bit.join(" ")}) — ${p.id}` : `${p.nama} — ${p.id}`;
  }
  return `${p.nama} — ${p.id}`;
}

/* ---------------- handler ---------------- */

export async function onRequestPost({ request, env }) {
  const isProduction = env.DOKU_ENV === "production";
  const DOKU_BASE = isProduction
    ? "https://api.doku.com"
    : "https://api-sandbox.doku.com";

  const clientId = env.DOKU_CLIENT_ID;
  const secretKey = env.DOKU_SECRET_KEY;
  const redirectUrl = env.DOKU_REDIRECT_URL;
  const kv = env.ORDERS; // BARU

  const kurang = [];
  if (!clientId) kurang.push("DOKU_CLIENT_ID");
  if (!secretKey) kurang.push("DOKU_SECRET_KEY");
  if (!redirectUrl) kurang.push("DOKU_REDIRECT_URL");
  if (!kv) kurang.push("KV binding ORDERS"); // BARU

  if (kurang.length) {
    console.error("Env belum diset:", kurang.join(", "));
    return json(
      { error: `Konfigurasi server belum lengkap: ${kurang.join(", ")}` },
      500
    );
  }

  console.log("=== create-order ===");
  console.log("DOKU_ENV          :", isProduction ? "production" : "sandbox");
  console.log("DOKU_BASE         :", DOKU_BASE);
  console.log("Client-Id         :", `${clientId.slice(0, 4)}… len=${clientId.length}`);
  console.log("DOKU_REDIRECT_URL :", urlAman(redirectUrl));
  console.log(
    "Notification URL  :",
    env.DOKU_NOTIFICATION_URL
      ? urlAman(env.DOKU_NOTIFICATION_URL)
      : "(tidak diset — webhook belum terdaftar, hanya referensi)"
  );
  console.log("KV ORDERS         :", "terpasang"); // BARU

  if (isProduction) console.warn("⚠️  Mode PRODUCTION: uang nyata");
  if (env.DOKU_CALLBACK_URL) {
    console.warn("DOKU_CALLBACK_URL masih terpasang — sudah tidak dipakai, hapus dari settings");
  }

  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return json({ error: "Payload terlalu besar" }, 413);

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }

  const slug = typeof payload?.slug === "string" ? payload.slug.trim() : "";
  if (!slug) return json({ error: "slug produk wajib diisi" }, 400);

  const hasil = await ambilProduk(request, env, slug);
  if (hasil.error) return json({ error: hasil.error }, hasil.status);

  const { produk } = hasil;
  console.log("Produk            :", produk.slug, "| harga:", produk.harga);

  const invoiceNumber = `INV-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const body = {
    order: {
      amount: produk.harga,
      invoice_number: invoiceNumber,
      currency: "IDR",
      callback_url: redirectUrl,
      auto_redirect: false,
    },
    payment: { payment_due_date: 60 },
    customer: {
      name: String(payload.nama || "Pelanggan").slice(0, 100),
      email: String(payload.email || "").slice(0, 100),
      phone: String(payload.telepon || "").slice(0, 20),
    },
    line_items: [
      { name: produk.label, price: produk.harga, quantity: 1, category: "katalog" },
    ],
  };

  const bodyString = JSON.stringify(body);
  const requestId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const digest = await sha256Base64(bodyString);

  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${TARGET_PATH}`,
    `Digest:${digest}`,
  ].join("\n");

  const signature = `HMACSHA256=${await hmacSha256Base64(secretKey, component)}`;

  let dokuRes;
  let data;
  try {
    dokuRes = await fetch(DOKU_BASE + TARGET_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Id": clientId,
        "Request-Id": requestId,
        "Request-Timestamp": timestamp,
        "Request-Target": TARGET_PATH,
        Digest: digest,
        Signature: signature,
      },
      body: bodyString,
    });
    data = await dokuRes.json();
  } catch (e) {
    console.error("Gagal menghubungi DOKU", e);
    return json({ error: "Gagal menghubungi penyedia pembayaran" }, 502);
  }

  const paymentUrl = data?.response?.payment?.url;
  if (!dokuRes.ok || !paymentUrl) {
    const pesan =
      data?.error?.message ||
      (Array.isArray(data?.message) ? data.message.join("; ") : data?.message) ||
      "Gagal membuat transaksi";
    console.error("DOKU menolak", {
      status: dokuRes.status,
      pesan,
      requestId,
      invoice: invoiceNumber,
    });
    return json({ error: pesan, requestId, invoice: invoiceNumber }, 502);
  }

  // BARU: simpan order DULU, baru beri link ke pembeli.
  // Kalau penyimpanan gagal, jangan kirim paymentUrl — supaya tidak ada
  // pembayaran yang tidak tercatat.
  try {
    await kv.put(
      `order:${invoiceNumber}`,
      JSON.stringify({
        invoice: invoiceNumber,
        requestId,
        id: produk.id,
        nama: produk.nama,
        amount: produk.harga,
        status: "PENDING",
        channel: null,
        env: isProduction ? "production" : "sandbox",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        paidAt: null,
      }),
      { expirationTtl: ORDER_TTL_DETIK }
    );
  } catch (e) {
    console.error("Gagal menyimpan order ke KV", { invoice: invoiceNumber, err: String(e) });
    return json(
      {
        error:
          "Pesanan gagal disimpan. Silakan coba lagi atau hubungi kami lewat WhatsApp.",
        invoice: invoiceNumber,
      },
      500
    );
  }

  console.log("OK                :", { invoice: invoiceNumber, requestId });
  return json({ paymentUrl, invoice: invoiceNumber, requestId });
}

export async function onRequest({ request }) {
  return json({ error: `Metode ${request.method} tidak didukung` }, 405);
}
