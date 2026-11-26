async function beliOtomatis(slug, tombol) {
  if (!tombol || tombol.disabled) return;
  const teksAsli = tombol.innerHTML;
  tombol.innerHTML = "⏳ Memproses...";
  tombol.disabled = true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("/api/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          'slug': slug,
          'nama': 'Ujang',
          'email': 'ujanggoogle@gmail.com',
          'telepon': '081234567890'
      }),
      signal: controller.signal,
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      // respons bukan JSON (misal 500 HTML dari Cloudflare)
    }

    if (response.ok && data.paymentUrl) {
      window.location.href = data.paymentUrl;
      return;
    }

    console.error("Gagal buat order:", response.status, data);
    alert(
      data.error ||
        "Gagal mendapatkan link pembayaran. Silakan coba lagi atau gunakan WhatsApp."
    );
  } catch (err) {
    if (err.name === "AbortError") {
      alert("Koneksi terlalu lama. Silakan coba lagi.");
    } else {
      console.error(err);
      alert("Terjadi kesalahan sistem.");
    }
  } finally {
    clearTimeout(timer);
    tombol.innerHTML = teksAsli;
    tombol.disabled = false;
  }
}
