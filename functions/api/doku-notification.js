// VERSI PENEMUAN — sementara, jangan dibiarkan di production
const enc = new TextEncoder();

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

const sha256B64 = async (t) => b64(await crypto.subtle.digest("SHA-256", enc.encode(t)));

const sha256Hex = async (t) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function hmacB64(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

function sama(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  const h = (k) => request.headers.get(k) ?? "";
  const secret = env.DOKU_SECRET_KEY;
  const url = new URL(request.url);
  const path = url.pathname;

  const clientId = h("client-id");
  const requestId = h("request-id");
  const ts = h("request-timestamp") || h("x-timestamp");

  console.log("=== DOKU NOTIF (penemuan) ===");
  console.log("PATH:", path);
  console.log("RAW:", raw);
  console.log("HEADERS:", JSON.stringify(Object.fromEntries(request.headers)));

  // simpan permanen: log Pages hanya streaming
  if (env.ORDERS) {
    await env.ORDERS.put(
      `rawnotif:${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      JSON.stringify({ raw, headers: Object.fromEntries(request.headers) }),
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  }

  if (!secret) {
    console.log("DOKU_SECRET_KEY kosong");
    return new Response("ok", { status: 200 });
  }

  const digestB64 = await sha256B64(raw);
  const digestHex = await sha256Hex(raw);
  const fullUrl = url.toString();

  const comp = (target, digest) =>
    [
      `Client-Id:${clientId}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${ts}`,
      `Request-Target:${target}`,
      `Digest:${digest}`,
    ].join("\n");

  const kandidat = [
    ["hmac(raw)", raw],
    ["hmac(raw+ts)", raw + ts],
    ["hmac(ts+raw)", ts + raw],
    ["hmac(clientId+ts+raw)", clientId + ts + raw],
    ["hmac(requestId+ts+raw)", requestId + ts + raw],
    ["hmac(clientId+requestId+ts+raw)", clientId + requestId + ts + raw],
    ["hmac(digestB64)", digestB64],
    ["hmac(digestHex)", digestHex],
    ["hmac(requestId+ts+digestB64)", requestId + ts + digestB64],
    ["comp(path, digestB64)", comp(path, digestB64)],
    ["comp(url, digestB64)", comp(fullUrl, digestB64)],
    ["comp(path, digestHex)", comp(path, digestHex)],
    ["comp(path+slash, digestB64)", comp(path + "/", digestB64)],
  ];

  const diterima = { Signature: h("signature"), "X-Signature": h("x-signature") };
  const bersih = (v) => v.replace(/^HMACSHA256=/i, "");

  let ketemu = false;
  for (const [label, msg] of kandidat) {
    const nilai = await hmacB64(secret, msg);
    for (const [hdr, rec] of Object.entries(diterima)) {
      if (rec && sama(nilai, bersih(rec))) {
        console.log("COCOK:", label, "->", hdr);
        ketemu = true;
      }
    }
  }
  if (!ketemu) console.log("TIDAK ADA kandidat yang cocok");

  return new Response("ok", { status: 200 });
}
