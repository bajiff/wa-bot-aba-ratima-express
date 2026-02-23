// server.js
import fs from 'fs';
import { appendFile } from 'fs/promises'; 
import qrcode from 'qrcode-terminal';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { initDB } from './database.js';

const app = express();
app.use(express.json());

// Konfigurasi Session
app.use(session({
    secret: 'rahasia-toko-aba-ratima-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // Sesi aktif 1 hari
}));

app.use(express.static('public'));

const LOG_FILE = 'data-penelitian.csv';
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

let db;
let model; 
const chatSessions = new Map(); 

// --- FUNGSI DYNAMIC UPDATE AI ---
async function updateGeminiModel() {
    console.log("🔄 Mengambil data terbaru dari SQLite untuk memori Bot...");
    const rows = await db.all('SELECT * FROM inventory');
    
    const inventoryTerbaru = rows.reduce((acc, curr) => {
        if (!acc[curr.kategori]) acc[curr.kategori] = [];
        acc[curr.kategori].push({
            id: curr.id, nama: curr.nama, varian: curr.varian, harga: curr.harga, stok: curr.stok
        });
        return acc;
    }, {});

    const TOKO_DATA_CONTEXT = JSON.stringify({
        profil_toko: { nama: "Toko Aba Ratima", pemilik: "Aba Ratima" },
        data_inventaris: { kategori_barang: inventoryTerbaru }
    }, null, 2);

    const SYSTEM_INSTRUCTION = `
        PERAN: Anda adalah "ABot", Asisten Virtual Toko Aba Ratima.

        ATURAN LOGIKA BALASAN (SANGAT PENTING):
        PERAN: Anda adalah "ABot", Aba Chatbot.
        TUGAS UTAMA:
        1. Jika User menyapa (Halo/P/Assalamualaikum) -> Berikan salam pembuka dan tawarkan bantuan.

        2. Jika User bertanya -> Jawab berdasarkan DATA JSON yang dilampirkan.

        3. Greeting atau awal pecakapan: Halo 👋!
        Saya ABot, Chatbot WhatsApp Toko Aba Ratima. Saya siap membantu Anda dengan informasi seputar 
        - Informasi toko 📍
        - Stok dan Harga Barang 🛒
        - Jam Operasional Toko ⏰
        - Metode Pembayaran 💳
        - Kebijakan Toko (Retur/Kasbon) 📝


        4. JIKA user BERTANYA atau MEMESAN (Contoh: "beli rokok", "caranya gimana", "stok beras"): 
        LANGSUNG jawab inti pertanyaannya berdasarkan Database. 
        DILARANG KERAS mengulang sapaan awal (Halo saya ABot...) atau menyebutkan ulang daftar menu/bantuan. Langsung berikan harga, stok, atau cara belinya.

        ATURAN FORMAT & GAYA BAHASA:
        - Komunikasi harus efisien, ramah, solutif, dan langsung ke intinya (To the point).
        - Gunakan emoji secukupnya agar tidak kaku.
        - **FORMAT WHATSAPP:** Gunakan (*) untuk menebalkan kata kunci (seperti harga/nama barang), dan (-) untuk daftar. Berikan jarak antar paragraf (Enter) agar rapi.

        ATURAN PENANGANAN BARANG KOSONG / VARIAN LAIN (NEW):
        - JIKA user mencari barang yang TIDAK ADA atau menanyakan VARIAN LAIN yang tidak terdaftar di Database, jawablah dengan bahasa natural bahwa barang tersebut tidak dijual/kosong. 
        - Contoh: "Mohon maaf Kak, untuk saat ini kami hanya menyediakan [Sebutkan barang yang ada di Database] saja." atau "Wah maaf Kak, untuk [Nama Barang] kebetulan kita belum jual nih."

        BATASAN KETAT (STRICT):
        - JANGAN MENGARANG/HALUSINASI. Info harga, stok, dan prosedur WAJIB 100% ditarik dari Database.
        - JIKA user bertanya hal di luar konteks toko (misal: nanya cuaca, politik, atau info admin yang tidak ada di Database), BARU gunakan template ini persis:
        "🤖 Mohon maaf, informasi tersebut belum tersedia dalam sistem kami. Silakan hubungi Admin Toko Aba di 0811-2222-3333."
        === DATA TOKO (SUMBER DATA) ===
        ${TOKO_DATA_CONTEXT}
        `;

    model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.3 }
    });
    
    chatSessions.clear(); 
    console.log("✅ Bot berhasil di-refresh dengan data terbaru!");
}

// --- MIDDLEWARE AUTENTIKASI ---
const checkAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized. Silakan login.' });
    }
};

// --- ENDPOINT OTORISASI ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id;
            res.json({ success: true, message: 'Login berhasil' });
        } else {
            res.status(401).json({ success: false, message: 'Username atau password salah!' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logout berhasil' });
});

app.get('/api/check-session', (req, res) => {
    if (req.session.userId) res.json({ loggedIn: true });
    else res.json({ loggedIn: false });
});

// --- API CRUD INVENTORY (Dilindungi checkAuth) ---
// READ
app.get('/api/inventory', checkAuth, async (req, res) => {
    const data = await db.all('SELECT * FROM inventory');
    res.json(data);
});

// CREATE
app.post('/api/inventory', checkAuth, async (req, res) => {
    const { id, kategori, nama, varian, harga, stok } = req.body;
    try {
        await db.run(
            'INSERT INTO inventory (id, kategori, nama, varian, harga, stok) VALUES (?, ?, ?, ?, ?, ?)',
            [id, kategori, nama, varian, harga, stok]
        );
        await updateGeminiModel();
        res.json({ success: true, message: "Barang berhasil ditambahkan!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "ID Barang mungkin sudah ada." });
    }
});

// UPDATE
app.put('/api/inventory/:id', checkAuth, async (req, res) => {
    const { harga, stok } = req.body;
    const { id } = req.params;
    try {
        await db.run('UPDATE inventory SET harga = ?, stok = ? WHERE id = ?', [harga, stok, id]);
        await updateGeminiModel();
        res.json({ success: true, message: "Data berhasil diupdate!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE
app.delete('/api/inventory/:id', checkAuth, async (req, res) => {
    const { id } = req.params;
    try {
        await db.run('DELETE FROM inventory WHERE id = ?', [id]);
        await updateGeminiModel();
        res.json({ success: true, message: "Barang berhasil dihapus!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// --- SETUP WHATSAPP BOT ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('[INFO] Bot WA Siap Melayani!'));

client.on('message', async msg => {
    if (msg.body === 'status@broadcast' || msg.from.includes('@g.us')) return;

    try {
        if (!chatSessions.has(msg.from)) {
            chatSessions.set(msg.from, model.startChat({ history: [] }));
        }
        
        const chat = chatSessions.get(msg.from);
        const result = await chat.sendMessage(msg.body);
        await msg.reply(result.response.text());
    } catch (error) {
        console.error(error);
    }
});

// --- INITIALIZE ALL ---
async function startServer() {
    db = await initDB();
    await updateGeminiModel(); 
    client.initialize(); 
    app.listen(3000, () => console.log('🌐 Web Admin berjalan di http://localhost:3000'));
}

startServer();