const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

// invoice mengandung UUID, cukup sulit ditebak, tapi tetap divalidasi formatnya
const POLA_INVOICE = /^INV-\d{10,16}-[A-Za-z0-9]{8}$/;

export async function onRequestGet({ request, env }) {
  const kv = env.ORDERS;
  if (!kv) return json({ error: "Konfigurasi server belum lengkap" }, 500);

  const invoice = (new URL(request.url).searchParams.get("invoice") || "").trim();
  if (!POLA_INVOICE.test(invoice)) {
    return json({ error: "Format invoice tidak valid" }, 400);
  }

  let order;
  try {
    order = await kv.get(`order:${invoice}`, "json");
  } catch (e) {
    console.error("Gagal membaca KV", e);
    return json({ error: "Gagal membaca status" }, 500);
  }

  if (!order) return json({ status: "TIDAK_DITEMUKAN" }, 404);

  // Hanya field yang aman ditampilkan ke browser
  return json({
    invoice: order.invoice,
    status: order.status,
    id: order.id,
    nama: order.nama,
    amount: order.amount,
    paidAt: order.paidAt ?? null,
    createdAt: order.createdAt,
  });
}

export async function onRequest({ request }) {
  return json({ error: `Metode ${request.method} tidak didukung` }, 405);
}
