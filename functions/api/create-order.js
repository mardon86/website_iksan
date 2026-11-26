const DOKU_BASE = "https://api-sandbox.doku.com"; // production: https://api.doku.com
const TARGET_PATH = "/checkout/v1/payment";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const toBase64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function sha256Base64(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64(buf);
}

async function hmacBase64(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return toBase64(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

// Ambil produk dari katalog yang sudah di-copy sebagai aset statis.
// Sesuaikan nama field dengan isi src/data/produk.json Anda.
async function cariProduk(request, slug) {
  const res = await fetch(new URL("/data/produk.json", request.url));
  if (!res.ok) return null;
  const data = await res.json();
  const list = Array.isArray(data) ? data : Object.values(data);
  return list.find((p) => p.slug === slug || p.id === slug) ?? null;
}

export async function onRequestPost({ request, env }) {
  const missing = [];
  if (!env.DOKU_CLIENT_ID) missing.push("DOKU_CLIENT_ID");
  if (!env.DOKU_SECRET_KEY) missing.push("DOKU_SECRET_KEY");
    
  if (missing.length) {
    console.error("Env belum diset:", missing.join(", "));
    return json({ error: `Konfigurasi server belum lengkap: ${missing.join(", ")}` }, 500);
  }
  
  const clientId = env.DOKU_CLIENT_ID;
  const secretKey = env.DOKU_SECRET_KEY;
  const callbackUrl = env.DOKU_CALLBACK_URL || new URL("/api/doku-notification", request.url).toString();

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Body bukan JSON yang valid" }, 400);
  }

  const slug = typeof payload?.slug === "string" ? payload.slug.trim() : "";
  if (!slug) return json({ error: "slug produk wajib diisi" }, 400);

  // HARGA DITENTUKAN DI SERVER, bukan dari client
  const produk = await cariProduk(request, slug);
  if (!produk) return json({ error: "Produk tidak ditemukan" }, 404);

  const harga = Number(produk.harga);
  if (!Number.isInteger(harga) || harga <= 0) {
    console.error("Harga tidak valid untuk produk", slug, produk.harga);
    return json({ error: "Harga produk tidak valid" }, 500);
  }
  const namaProduk = produk.nama || produk.title || slug;

  const invoiceNumber = `INV-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const body = {
    order: {
      amount: harga,
      invoice_number: invoiceNumber,
      currency: "IDR",
      callback_url: callbackUrl,
      auto_redirect: true,
    },
    payment: { payment_due_date: 60 },
    customer: {
      name: String(payload.nama || "Pelanggan").slice(0, 100),
      email: String(payload.email || "").slice(0, 100),
      phone: String(payload.telepon || "").slice(0, 20),
    },
    line_items: [{ name: namaProduk, price: harga, quantity: 1, category: "katalog" }],
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

  const signature = `HMACSHA256=${await hmacBase64(secretKey, component)}`;

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
    console.error("DOKU menolak", dokuRes.status, JSON.stringify(data));
    return json(
      {
        error: data?.error?.message || data?.message || "Gagal membuat transaksi",
        code: data?.error?.code,
        invoice: invoiceNumber,
      },
      502
    );
  }

  return json({ paymentUrl, invoice: invoiceNumber });
}
