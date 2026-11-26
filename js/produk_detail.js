// ===== FUNGSI BELI OTOMATIS =====
async function beliOtomatis(namaProduk, harga) {
  // Ganti teks tombol jadi loading
  const tombol = event.target;
  const teksAsli = tombol.innerHTML;
  tombol.innerHTML = "⏳ Memproses...";
  tombol.disabled = true;

  try {
    // Panggil API Cloudflare Pages Function kita
    const response = await fetch('/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        namaProduk: namaProduk, 
        amount: harga 
      })
    });

    const data = await response.json();

    if (data.paymentUrl) {
      // Arahkan pembeli ke halaman pembayaran DOKU
      window.location.href = data.paymentUrl;
    } else {
      alert("Gagal mendapatkan link pembayaran. Silakan coba lagi atau gunakan WhatsApp.");
      tombol.innerHTML = teksAsli;
      tombol.disabled = false;
    }
  } catch (error) {
    console.error(error);
    alert("Terjadi kesalahan sistem.");
    tombol.innerHTML = teksAsli;
    tombol.disabled = false;
  }
}