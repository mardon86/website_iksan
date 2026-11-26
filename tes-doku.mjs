import crypto from 'node:crypto';

// tes-doku.mjs
const clientId = process.env.DOKU_CLIENT_ID;
const secretKey = process.env.DOKU_SECRET_KEY;
const base = "https://api-sandbox.doku.com";
const target = "/checkout/v1/payment";

console.log("len clientId:", clientId.length);

const body = JSON.stringify({
  order: {
    amount: 10000,
    invoice_number: `TEST-${Date.now()}`,
    currency: "IDR",
    callback_url: "https://example.com/cb",
  },
  payment: { payment_due_date: 60 },
  customer: { name: "Tes", email: "tes@example.com", phone: "08123456789" },
});

const enc = new TextEncoder();
const digestBuf = await crypto.subtle.digest("SHA-256", enc.encode(body));
const digest = Buffer.from(digestBuf).toString("base64");

const requestId = crypto.randomUUID();
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const component = [
  `Client-Id:${clientId}`,
  `Request-Id:${requestId}`,
  `Request-Timestamp:${timestamp}`,
  `Request-Target:${target}`,
  `Digest:${digest}`,
].join("\n");

const { createHmac } = await import("node:crypto");
const signature = "HMACSHA256=" + createHmac("sha256", secretKey).update(component).digest("base64");

const res = await fetch(base + target, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Client-Id": clientId,
    "Request-Id": requestId,
    "Request-Timestamp": timestamp,
    "Request-Target": target,
    Digest: digest,
    Signature: signature,
  },
  body,
});

console.log(res.status, await res.text());
