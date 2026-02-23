// seeder.js
import fs from 'fs';
import bcrypt from 'bcrypt';
import { initDB } from './database.js';

async function runSeeder() {
    console.log("🌱 Menjalankan proses seeding...");
    
    // Panggil koneksi DB
    const db = await initDB();

    try {
        // --- 1. SEEDER USER ADMIN ---
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        if (userCount.count === 0) {
            console.log("⚙️ Membuat akun admin default...");
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash('bajiadmin123', saltRounds); 
            
            await db.run(
                'INSERT INTO users (username, password) VALUES (?, ?)',
                ['bajiadmin', hashedPassword]
            );
            console.log("✅ Akun admin berhasil di-seed! (Username: bajiadmin)");
        } else {
            console.log("ℹ️ Akun admin sudah ada di database. Melewati proses seeding user.");
        }

        // --- 2. SEEDER / MIGRATION INVENTORY ---
        const invCount = await db.get('SELECT COUNT(*) as count FROM inventory');
        if (invCount.count === 0 && fs.existsSync('data-toko-aba-ratima.json')) {
            console.log("📦 Mulai migrasi data dari JSON ke SQLite...");
            const rawData = fs.readFileSync('data-toko-aba-ratima.json', 'utf8');
            const jsonData = JSON.parse(rawData);
            
            const inventaris = jsonData.data_inventaris.kategori_barang;
            
            for (const [kategori, barangArr] of Object.entries(inventaris)) {
                for (const barang of barangArr) {
                    await db.run(
                        'INSERT INTO inventory (id, kategori, nama, varian, harga, stok) VALUES (?, ?, ?, ?, ?, ?)',
                        [barang.id, kategori, barang.nama, barang.varian, barang.harga, barang.stok]
                    );
                }
            }
            console.log("✅ Migrasi inventory selesai!");
        } else {
             console.log("ℹ️ Data inventory sudah ada atau file JSON tidak ditemukan. Melewati seeding inventory.");
        }

        console.log("🎉 Proses seeding selesai dengan sukses!");
    } catch (error) {
        console.error("❌ Terjadi kesalahan saat seeding:", error);
    } finally {
        // Tutup koneksi secara aman setelah script selesai
        await db.close();
        process.exit(0); 
    }
}

// Eksekusi fungsi
runSeeder();