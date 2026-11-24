#!/usr/bin/env node
/**
 * Build katalog ringkasan dari src/_data/produk/*.json
 * - Generate src/data/<kategori>.json (ringkasan untuk katalog)
 * - Validasi: id duplikat, field wajib, gambar hilang, id vs nama file
 */

const fs = require("fs");
const path = require("path");

// ===== KONFIGURASI =====
const PRODUK_DIR = "src/_data/produk-data";
const IMG_DIR = "src/img";
const OUT_DIR = "src/data";
const FIELD_WAJIB = ["id", "nama", "kategori", "merek", "ukuran", "harga", "stok", "gambar", "deskripsi"];
const FIELD_RINGKAS = ["id", "nama", "kategori", "merek", "ukuran", "pcd", "offset", "lebar", "rasio", "ring", "tipe", "harga", "stok", "gambar"];

// ===== UTIL =====
const warna = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let errorCount = 0;
let warningCount = 0;

function error(msg) {
  console.log(warna.red("  ✗ ") + msg);
  errorCount++;
}

function warn(msg) {
  console.log(warna.yellow("  ⚠ ") + msg);
  warningCount++;
}

function ok(msg) {
  console.log(warna.green("  ✓ ") + msg);
}

// ===== CEK FOLDER =====
if (!fs.existsSync(PRODUK_DIR)) {
  console.error(warna.red(`Folder tidak ditemukan: ${PRODUK_DIR}`));
  process.exit(1);
}

// ===== BACA SEMUA FILE =====
const files = fs.readdirSync(PRODUK_DIR).filter((f) => f.endsWith(".json"));

if (files.length === 0) {
  console.error(warna.red(`Tidak ada file .json di ${PRODUK_DIR}`));
  process.exit(1);
}

console.log(warna.bold(`\n📦 Memproses ${files.length} file produk...\n`));

const semuaProduk = [];
const idTerpakai = new Map(); // id → nama file (untuk deteksi duplikat)

// ===== VALIDASI PER FILE =====
files.forEach((file) => {
  const filePath = path.join(PRODUK_DIR, file);
  const fileId = file.replace(/\.json$/, "");

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    error(`${file}: JSON tidak valid — ${err.message}`);
    return;
  }

  // 1. Field wajib
  const missing = FIELD_WAJIB.filter((f) => data[f] === undefined || data[f] === "");
  if (missing.length > 0) {
    error(`${file}: field wajib kosong → ${missing.join(", ")}`);
    return;
  }

  // 2. id vs nama file
  if (data.id !== fileId) {
    error(`${file}: id "${data.id}" tidak sama dengan nama file "${fileId}"`);
    return;
  }

  // 3. id duplikat
  if (idTerpakai.has(data.id)) {
    error(`${file}: id "${data.id}" duplikat dengan ${idTerpakai.get(data.id)}`);
    return;
  }
  idTerpakai.set(data.id, file);

  // 4. Tipe data
  if (typeof data.harga !== "number") {
    error(`${file}: "harga" harus angka, bukan ${typeof data.harga}`);
    return;
  }
  if (typeof data.stok !== "boolean") {
    error(`${file}: "stok" harus boolean (true/false), bukan ${typeof data.stok}`);
    return;
  }

  // 5. Kategori valid
  //if (!["velg", "ban"].includes(data.kategori)) {
  //  error(`${file}: kategori "${data.kategori}" tidak valid (harus "velg" atau "ban")`);
  //  return;
  //}

  // 6. Gambar ada?
  const imgPath = path.join(IMG_DIR, data.gambar);
  if (!fs.existsSync(imgPath)) {
    warn(`${file}: gambar "${data.gambar}" tidak ditemukan di ${IMG_DIR}/`);
  }

  // 7. Ukuran numerik (untuk filter)
  if (isNaN(Number(data.ukuran))) {
    warn(`${file}: "ukuran" bukan angka ("${data.ukuran}") — filter ukuran mungkin tidak jalan`);
  }

  semuaProduk.push(data);
});

// ===== GROUPING PER KATEGORI =====
//const perKategori = {};
//semuaProduk.forEach((p) => {
//  perKategori[p.kategori] = perKategori[p.kategori] || [];
//  perKategori[p.kategori].push(p);
//});

// ===== TULIS RINGKASAN =====
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log(warna.bold("\n📝 Menulis file ringkasan:\n"));


/*
Object.entries(perKategori).forEach(([kategori, items]) => {
  // Sort: stok tersedia dulu, lalu nama
  items.sort((a, b) => {
    if (a.stok !== b.stok) return b.stok - a.stok;
    return a.nama.localeCompare(b.nama);
  });

  // Ambil hanya field ringkas
  const ringkas = items.map((p) => {
    const obj = {};
    FIELD_RINGKAS.forEach((f) => {
      if (p[f] !== undefined) obj[f] = p[f];
    });
    return obj;
  });

  const outPath = path.join(OUT_DIR, `${kategori}.json`);
  fs.writeFileSync(outPath, JSON.stringify(ringkas));

  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  ok(`${outPath} — ${ringkas.length} item (${sizeKB} KB)`);
});
*/

(function(){
  semuaProduk.sort((a, b) => {
    if (a.stok !== b.stok) return b.stok - a.stok;
      return a.nama.localeCompare(b.nama);
  });

  // Ambil hanya field ringkas
  const ringkas = semuaProduk.map((p) => {
    const obj = {};
    FIELD_RINGKAS.forEach((f) => {
      if (p[f] !== undefined) obj[f] = p[f];
    });
    return obj;
  });

  const outPath = path.join(OUT_DIR, `produk.json`);
  fs.writeFileSync(outPath, JSON.stringify(ringkas));

  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
  ok(`${outPath} — ${ringkas.length} item (${sizeKB} KB)`);
})();

// ===== RINGKASAN AKHIR =====
console.log(warna.bold("\n" + "─".repeat(50)));

if (errorCount === 0 && warningCount === 0) {
  console.log(warna.green(warna.bold(`✅ Semua ${files.length} file valid. Build selesai.`)));
  process.exit(0);
}

if (errorCount > 0) {
  console.log(warna.red(warna.bold(`❌ ${errorCount} error, ${warningCount} warning.`)));
  console.log(warna.red("   Perbaiki error di atas sebelum deploy.\n"));
  process.exit(1);
}

// Hanya warning, tetap lanjut
console.log(warna.yellow(warna.bold(`⚠ ${warningCount} warning. Build tetap dilanjutkan.`)));
console.log(warna.yellow("   Cek gambar yang hilang sebelum deploy.\n"));
process.exit(0);
