// ===== KONFIGURASI =====
const WA_NUMBER = "6281214424448"; 
const BATCH_SIZE = 20;             

// ===== STATE =====
let semuaProduk = [];
let hasilFilter = [];
let ditampilkan = 0;

// ===== UTIL =====
function formatRupiah(angka) {
  return "Rp " + Number(angka).toLocaleString("id-ID");
}

function linkWA(namaProduk) {
  const pesan = encodeURIComponent(
    `Halo, saya tertarik dengan produk *${namaProduk}*. Apakah masih tersedia?`
  );
  return `https://wa.me/${WA_NUMBER}?text=${pesan}`;
}

// ===== RENDER KARTU =====
function buatKartu(p) {
  const badge = p.stok
    ? '<span class="absolute top-2.5 right-2.5 text-xs font-semibold bg-emerald-500 text-white px-2.5 py-1 rounded-full">Tersedia</span>'
    : '<span class="absolute top-2.5 right-2.5 text-xs font-semibold bg-red-500 text-white px-2.5 py-1 rounded-full">Habis</span>';
  
  var spek;
  if (p.kategori === "velg") {
      spek = `Ring ${p.ukuran} • PCD ${p.pcd}`;
  } else if (p.kategori === "ban") {
      spek = `${p.lebar}/${p.rasio} R${p.ring} • ${p.tipe || "Tubeless"}`;
  } else {
      spek = `Ukuran ${p.ukuran} • ${p.merek}`;
  }

  return `
    <a href="/produk/${p.id}/" class="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all block">
      <div class="relative aspect-square bg-gray-100 bg-cover bg-center" style="background-image:url('/img/${p.gambar}')">
        ${badge}
      </div>
      <div class="p-4">
        <span class="text-xs uppercase tracking-wide text-brand font-semibold">${p.kategori}</span>
        <h3 class="text-base font-medium mt-1.5 mb-2 leading-snug">${p.nama}</h3>
        <div class="text-xs text-gray-500 mb-3">${spek}</div>
        <div class="text-lg font-bold">${formatRupiah(p.harga)}</div>
      </div>
    </a>
  `;
}

// ===== RENDER BATCH (LAZY LOAD) =====
function renderBatch() {
  const grid = document.getElementById("grid-produk");
  if (!grid) return;

  const slice = hasilFilter.slice(ditampilkan, ditampilkan + BATCH_SIZE);
  grid.insertAdjacentHTML("beforeend", slice.map(buatKartu).join(""));
  ditampilkan += slice.length;

  const btn = document.getElementById("muat-lagi");
  if (btn) {
    if (ditampilkan >= hasilFilter.length) {
      btn.classList.add("hidden");
    } else {
      btn.classList.remove("hidden");
    }
  }

  // Pesan jika kosong
  if (hasilFilter.length === 0) {
    grid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-10">Tidak ada produk yang cocok.</p>`;
  }
}

function resetDanRender() {
  const grid = document.getElementById("grid-produk");
  if (!grid) return;
  grid.innerHTML = "";
  ditampilkan = 0;
  renderBatch();
}


// ===== FILTER =====
function punyaKategori(p, kat) {
  if (!p.kategori) return false;
  if (Array.isArray(p.kategori)) return p.kategori.includes(kat);
  return p.kategori === kat; // fallback kalau masih string
}


function isiFilterKategori() {
  const sel = document.getElementById("filter-kategori");
  if (!sel) return;
  const kategoriUnik = [...new Set(semuaProduk.map((p) => p.kategori))].sort();
  sel.innerHTML = `<option value="">Semua Kategori</option>` +
    kategoriUnik.map((k) => `<option value="${k}">${k}</option>`).join("");
}

function isiFilterMerek() {
  const sel = document.getElementById("filter-merek");
  if (!sel) return;
  const merekUnik = [...new Set(semuaProduk.map((p) => p.merek))].sort();
  sel.innerHTML = `<option value="">Semua Merek</option>` +
    merekUnik.map((m) => `<option value="${m}">${m}</option>`).join("");
}

function terapkanFilter() {
  const kategori = document.getElementById("filter-kategori")?.value || "";
  const merek = document.getElementById("filter-merek")?.value || "";
  const ukuran = document.getElementById("filter-ukuran")?.value || "";
  const cari = document.getElementById("filter-cari")?.value.toLowerCase() || "";

  hasilFilter = semuaProduk.filter((p) => {
    if (kategori && !punyaKategori(p, kategori) return false;
    if (merek && p.merek !== merek) return false;
    if (ukuran && p.ukuran !== ukuran) return false;
    if (cari && !p.nama.toLowerCase().includes(cari)) return false;
    return true;
  });

  resetDanRender();
}

// ===== INIT =====
async function initKatalog() {
  const grid = document.getElementById("grid-produk");
  if (!grid) return;

  //const kategori = grid.dataset.kategori; // "velg" atau "ban"
  //if (!kategori) return;

  try {
    //const res = await fetch(`/data/${kategori}.json`);
    const res = await fetch(`/data/produk.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    semuaProduk = await res.json();
  } catch (err) {
    console.error("Gagal memuat produk:", err);
    grid.innerHTML = `<p class="col-span-full text-center text-red-500 py-10">Gagal memuat produk. Coba refresh halaman.</p>`;
    return;
  }

  isiFilterKategori();
  isiFilterMerek();
  hasilFilter = semuaProduk;
  resetDanRender();

  // Event: tombol muat lagi
  document.getElementById("muat-lagi")?.addEventListener("click", renderBatch);

  // Event: filter
  ["filter-kategori", "filter-merek", "filter-ukuran", "filter-cari"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", terapkanFilter);
  });
}

// ===== EXPORT (untuk halaman detail jika masih perlu) =====
window.formatRupiah = formatRupiah;
window.linkWA = linkWA;

document.addEventListener("DOMContentLoaded", initKatalog);
