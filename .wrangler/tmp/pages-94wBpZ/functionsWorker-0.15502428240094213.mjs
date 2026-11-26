var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/create-order.js
var TARGET_PATH = "/checkout/v1/payment";
var MAX_BODY_BYTES = 8 * 1024;
var ORDER_TTL_DETIK = 60 * 60 * 24 * 30;
var json = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
}), "json");
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(toBase64, "toBase64");
async function sha256Base64(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64(buf);
}
__name(sha256Base64, "sha256Base64");
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
__name(hmacSha256Base64, "hmacSha256Base64");
function urlAman(nilai) {
  if (!nilai) return "(kosong)";
  try {
    const u = new URL(nilai);
    return `${u.origin}${u.pathname}`;
  } catch {
    return `(tidak valid: ${String(nilai).slice(0, 60)})`;
  }
}
__name(urlAman, "urlAman");
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
      label: buatLabel(produk)
      // untuk line_items DOKU
    }
  };
}
__name(ambilProduk, "ambilProduk");
function buatLabel(p) {
  if (p.kategori === "velg") {
    const bit = [];
    if (p.ukuran) bit.push(`${p.ukuran}"`);
    if (p.pcd) bit.push(p.pcd);
    if (p.offset) bit.push(p.offset);
    return bit.length ? `${p.nama} (${bit.join(" ")}) \u2014 ${p.id}` : `${p.nama} \u2014 ${p.id}`;
  }
  return `${p.nama} \u2014 ${p.id}`;
}
__name(buatLabel, "buatLabel");
async function onRequestPost({ request, env }) {
  const isProduction = env.DOKU_ENV === "production";
  const DOKU_BASE = isProduction ? "https://api.doku.com" : "https://api-sandbox.doku.com";
  const clientId = env.DOKU_CLIENT_ID;
  const secretKey = env.DOKU_SECRET_KEY;
  const redirectUrl = env.DOKU_REDIRECT_URL;
  const kv = env.ORDERS;
  const kurang = [];
  if (!clientId) kurang.push("DOKU_CLIENT_ID");
  if (!secretKey) kurang.push("DOKU_SECRET_KEY");
  if (!redirectUrl) kurang.push("DOKU_REDIRECT_URL");
  if (!kv) kurang.push("KV binding ORDERS");
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
  console.log("Client-Id         :", `${clientId.slice(0, 4)}\u2026 len=${clientId.length}`);
  console.log("DOKU_REDIRECT_URL :", urlAman(redirectUrl));
  console.log(
    "Notification URL  :",
    env.DOKU_NOTIFICATION_URL ? urlAman(env.DOKU_NOTIFICATION_URL) : "(tidak diset \u2014 webhook belum terdaftar, hanya referensi)"
  );
  console.log("KV ORDERS         :", "terpasang");
  if (isProduction) console.warn("\u26A0\uFE0F  Mode PRODUCTION: uang nyata");
  if (env.DOKU_CALLBACK_URL) {
    console.warn("DOKU_CALLBACK_URL masih terpasang \u2014 sudah tidak dipakai, hapus dari settings");
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
      auto_redirect: false
    },
    payment: { payment_due_date: 60 },
    customer: {
      name: String(payload.nama || "Pelanggan").slice(0, 100),
      email: String(payload.email || "").slice(0, 100),
      phone: String(payload.telepon || "").slice(0, 20)
    },
    line_items: [
      { name: produk.label, price: produk.harga, quantity: 1, category: "katalog" }
    ]
  };
  const bodyString = JSON.stringify(body);
  const requestId = crypto.randomUUID();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const digest = await sha256Base64(bodyString);
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${TARGET_PATH}`,
    `Digest:${digest}`
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
        Signature: signature
      },
      body: bodyString
    });
    data = await dokuRes.json();
  } catch (e) {
    console.error("Gagal menghubungi DOKU", e);
    return json({ error: "Gagal menghubungi penyedia pembayaran" }, 502);
  }
  const paymentUrl = data?.response?.payment?.url;
  if (!dokuRes.ok || !paymentUrl) {
    const pesan = data?.error?.message || (Array.isArray(data?.message) ? data.message.join("; ") : data?.message) || "Gagal membuat transaksi";
    console.error("DOKU menolak", {
      status: dokuRes.status,
      pesan,
      requestId,
      invoice: invoiceNumber
    });
    return json({ error: pesan, requestId, invoice: invoiceNumber }, 502);
  }
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
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        paidAt: null
      }),
      { expirationTtl: ORDER_TTL_DETIK }
    );
  } catch (e) {
    console.error("Gagal menyimpan order ke KV", { invoice: invoiceNumber, err: String(e) });
    return json(
      {
        error: "Pesanan gagal disimpan. Silakan coba lagi atau hubungi kami lewat WhatsApp.",
        invoice: invoiceNumber
      },
      500
    );
  }
  console.log("OK                :", { invoice: invoiceNumber, requestId });
  return json({ paymentUrl, invoice: invoiceNumber, requestId });
}
__name(onRequestPost, "onRequestPost");
async function onRequest({ request }) {
  return json({ error: `Metode ${request.method} tidak didukung` }, 405);
}
__name(onRequest, "onRequest");

// api/doku-notification.js
var MAX_BODY_BYTES2 = 256 * 1024;
var TOLERANSI_DETIK = 600;
function toBase642(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
__name(toBase642, "toBase64");
async function sha256Base642(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase642(buf);
}
__name(sha256Base642, "sha256Base64");
async function hmacSha256Base642(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toBase642(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}
__name(hmacSha256Base642, "hmacSha256Base64");
function samaPersis(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(samaPersis, "samaPersis");
var balas = /* @__PURE__ */ __name((pesan, status = 200) => new Response(pesan, {
  status,
  headers: {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  }
}), "balas");
async function verifikasi({ request, raw, secretKey }) {
  const h = /* @__PURE__ */ __name((k) => request.headers.get(k) ?? "", "h");
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
  const digest = await sha256Base642(raw);
  if (!samaPersis(digest, digestHeader)) {
    return { ok: false, reason: "digest tidak cocok" };
  }
  const component = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${timestamp}`,
    `Request-Target:${target}`,
    `Digest:${digest}`
  ].join("\n");
  const expected = `HMACSHA256=${await hmacSha256Base642(secretKey, component)}`;
  if (!samaPersis(expected, signatureHeader)) {
    return { ok: false, reason: "signature tidak cocok" };
  }
  const pathname = new URL(request.url).pathname;
  if (target !== pathname) {
    console.warn("Request-Target beda dari pathname:", { target, pathname });
  }
  const umurDetik = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1e3;
  if (!Number.isFinite(umurDetik) || umurDetik > TOLERANSI_DETIK) {
    console.warn("Timestamp notifikasi jauh dari sekarang:", { timestamp, umurDetik });
  }
  return { ok: true, digest, requestId };
}
__name(verifikasi, "verifikasi");
function bacaNotifikasi(payload) {
  const invoice = payload?.order?.invoice_number ?? payload?.order?.invoiceNumber ?? payload?.invoice_number ?? null;
  const status = payload?.transaction?.status ?? payload?.payment?.status ?? payload?.status ?? null;
  const amount = payload?.order?.amount ?? payload?.transaction?.amount ?? payload?.amount ?? null;
  const channel = payload?.channel?.id ?? payload?.service?.id ?? payload?.acquirer?.id ?? null;
  return {
    invoice,
    status: status ? String(status).toUpperCase() : null,
    amount: amount === null ? null : Number(amount),
    channel,
    waktu: payload?.transaction?.date ?? payload?.payment?.date ?? null
  };
}
__name(bacaNotifikasi, "bacaNotifikasi");
async function onRequestPost2({ request, env }) {
  const secretKey = env.DOKU_SECRET_KEY;
  if (!secretKey) {
    console.error("DOKU_SECRET_KEY belum diset");
    return balas("server misconfigured", 500);
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES2) {
    return balas("payload terlalu besar", 413);
  }
  let raw;
  try {
    raw = await request.text();
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
    return balas("ok", 200);
  }
  console.log("Notif DOKU", {
    invoice: notif.invoice,
    status: notif.status,
    amount: notif.amount,
    channel: notif.channel,
    requestId: hasil.requestId
  });
  const kv = env.ORDERS;
  if (!kv) {
    console.warn("Binding KV ORDERS belum ada \u2014 status tidak disimpan");
    return balas("ok", 200);
  }
  const key = `order:${notif.invoice}`;
  let order = null;
  try {
    order = await kv.get(key, "json");
  } catch (e) {
    console.error("Gagal membaca KV", e);
    return balas("internal error", 500);
  }
  if (!order) {
    console.error("Order tidak dikenal:", notif.invoice);
    return balas("ok", 200);
  }
  if (notif.amount !== null && Number(order.amount) !== notif.amount) {
    console.error("AMOUNT TIDAK COCOK", {
      invoice: notif.invoice,
      tercatat: order.amount,
      dariDoku: notif.amount
    });
    return balas("ok", 200);
  }
  const final = /* @__PURE__ */ new Set(["SUCCESS", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]);
  if (final.has(order.status) && order.status !== notif.status) {
    console.warn("Status final sudah ada, diabaikan", {
      invoice: notif.invoice,
      lama: order.status,
      baru: notif.status
    });
    return balas("ok", 200);
  }
  const updated = {
    ...order,
    status: notif.status,
    channel: notif.channel ?? order.channel ?? null,
    paidAt: notif.status === "SUCCESS" ? (/* @__PURE__ */ new Date()).toISOString() : order.paidAt ?? null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastRequestId: hasil.requestId,
    lastNotif: payload
  };
  try {
    await kv.put(key, JSON.stringify(updated));
  } catch (e) {
    console.error("Gagal menulis KV", e);
    return balas("internal error", 500);
  }
  console.log("Order diperbarui", { invoice: notif.invoice, status: notif.status });
  return balas("ok", 200);
}
__name(onRequestPost2, "onRequestPost");
async function onRequest2({ request }) {
  return balas(`Metode ${request.method} tidak didukung`, 405);
}
__name(onRequest2, "onRequest");

// api/order-status.js
var json2 = /* @__PURE__ */ __name((body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
}), "json");
var POLA_INVOICE = /^INV-\d{10,16}-[A-Za-z0-9]{8}$/;
async function onRequestGet({ request, env }) {
  const kv = env.ORDERS;
  if (!kv) return json2({ error: "Konfigurasi server belum lengkap" }, 500);
  const invoice = (new URL(request.url).searchParams.get("invoice") || "").trim();
  if (!POLA_INVOICE.test(invoice)) {
    return json2({ error: "Format invoice tidak valid" }, 400);
  }
  let order;
  try {
    order = await kv.get(`order:${invoice}`, "json");
  } catch (e) {
    console.error("Gagal membaca KV", e);
    return json2({ error: "Gagal membaca status" }, 500);
  }
  if (!order) return json2({ status: "TIDAK_DITEMUKAN" }, 404);
  return json2({
    invoice: order.invoice,
    status: order.status,
    id: order.id,
    nama: order.nama,
    amount: order.amount,
    paidAt: order.paidAt ?? null,
    createdAt: order.createdAt
  });
}
__name(onRequestGet, "onRequestGet");
async function onRequest3({ request }) {
  return json2({ error: `Metode ${request.method} tidak didukung` }, 405);
}
__name(onRequest3, "onRequest");

// ../.wrangler/tmp/pages-94wBpZ/functionsRoutes-0.39159319655667324.mjs
var routes = [
  {
    routePath: "/api/create-order",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/doku-notification",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/order-status",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/create-order",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/doku-notification",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/order-status",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  }
];

// ../../../.npm/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function getOriginalPathPrefix(requestPath, normalizedPrefix) {
  let end = 0;
  for (let index = 0; index < normalizedPrefix.length; index++) {
    end++;
    if (normalizedPrefix[index] === "/") {
      while (requestPath[end] === "/") {
        end++;
      }
    }
  }
  return requestPath.slice(0, end);
}
__name(getOriginalPathPrefix, "getOriginalPathPrefix");
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  const normalizedRequestPath = requestPath.replace(/\/+/g, "/");
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath) || routeMatcher(normalizedRequestPath);
    const originalMountMatch = mountMatcher(requestPath);
    const mountMatchResult = originalMountMatch || mountMatcher(normalizedRequestPath);
    if (matchResult && mountMatchResult) {
      const path = originalMountMatch ? originalMountMatch.path : getOriginalPathPrefix(requestPath, mountMatchResult.path);
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-WiODN2/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-WiODN2/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.15502428240094213.mjs.map
