// ? database.js
// database.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function initDB() {
    const db = await open({
        filename: './toko-aba-ratima.db',
        driver: sqlite3.Database
    });

    // 1. Buat tabel inventory
    await db.exec(`
        CREATE TABLE IF NOT EXISTS inventory (
            id TEXT PRIMARY KEY,
            kategori TEXT,
            nama TEXT,
            varian TEXT,
            harga INTEGER,
            stok INTEGER
        )
    `);

    // 2. Buat tabel users untuk Login Admin
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        )
    `);

    return db;
}