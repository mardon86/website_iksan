// functions/api/create-order.js
export async function onRequestPost(context) {
  const { request, env } = context;
  
  // 1. Dapatkan data dari frontend (misalnya amount)
  const { amount } = await request.json(); 
  
  // 2. Siapkan kredensial
  const clientId = env.DOKU_CLIENT_ID;
  const secretKey = env.DOKU_SECRET_KEY;
  const targetPath = '/checkout/v1/payment';
  const requestId = crypto.randomUUID();
  // Format timestamp harus ISO8601 UTC, misalnya: 2026-11-23T10:00:00Z
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // 3. Bangun body permintaan DOKU (disederhanakan)
  const body = {
    order: {
      amount: amount,
      invoice_number: `INV-${Date.now()}`,
      currency: "IDR",
      callback_url: "https://domain-anda.com/callback" // Halaman yang dituju setelah pembayaran selesai
    },
    payment: { payment_due_date: 60 }
  };
  const bodyString = JSON.stringify(body);

  // 4. Hitung Digest (SHA-256 -> Base64)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(bodyString));
  const digest = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));

  // 5. Bangun string komponen Signature
  // Perhatikan: setiap baris dipisahkan dengan \n, dan tidak ada baris kosong tambahan di akhir
  const component = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${timestamp}\nRequest-Target:${targetPath}\nDigest:${digest}`;

  // 6. Hitung Signature dengan HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(component));
  const signature = `HMACSHA256=${btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))}`;

  // 7. Kirim permintaan ke DOKU
  const dokuResponse = await fetch('https://api-sandbox.doku.com/checkout/v1/payment', { // Production ganti dengan https://api.doku.com
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Id': clientId,
      'Request-Id': requestId,
      'Request-Timestamp': timestamp,
      'Request-Target': targetPath,
      'Digest': digest,
      'Signature': signature,
    },
    body: bodyString,
  });

  const data = await dokuResponse.json();
  
  // 8. Kembalikan URL pembayaran ke frontend
  return new Response(JSON.stringify({ 
    paymentUrl: data.response?.payment?.url 
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}