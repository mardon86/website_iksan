// Contoh logika di frontend
document.getElementById('beli-btn').addEventListener('click', async () => {
  const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: 3500000 }) // amount diambil dari data produk
  });
  
  const data = await response.json();
  if (data.paymentUrl) {
    window.location.href = data.paymentUrl; // Arahkan ke halaman pembayaran DOKU
  } else {
    alert('Gagal membuat pesanan, silakan coba lagi.');
  }
});
