// server.js — GPTMart Connector (v4)
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

async function startServer() {
  const { v4: uuidv4 } = await import('uuid');

  // --- CONFIG ---
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0';
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR, 'db.json');

  // Comma-separated origins; fall back to common ones
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || [
    'https://www.gptmrt.com',
    'https://gptmrt.com',
    'http://localhost:5173', // vite
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ].join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // --- DB HELPERS ---
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      const json = JSON.parse(data);
      if (!Array.isArray(json.items)) json.items = [];
      if (!Array.isArray(json.leads)) json.leads = [];
      return json;
    } catch {
      const seed = [{
        title: "Bug Meme GPT",
        desc: "Turns bugs into instant memes.",
        icon: "https://cdn-icons-png.flaticon.com/512/3221/3221614.png",
        categories: ["Humor", "Tools"],
        url: "https://chatgpt.com/g/g-68dab3b8cebc819180d1b629ab574579-bug-meme-gpt?model=gpt-5"
      }];
      const data = {
        settings: { title: "GPTMart" },
        items: seed.map(s => ({
          id: uuidv4(),
          createdAt: Date.now(),
          status: 'hidden',
          featured: false,
          ...s
        })),
        leads: []
      };
      await writeDB(data);
      return data;
    }
  }

  let writing = false;
  const queue = [];
  async function writeDB(data) {
    if (writing) { queue.push(data); return; }
    writing = true;
    try {
      const tmp = DB_PATH + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, DB_PATH);
    } finally {
      writing = false;
      if (queue.length) writeDB(queue.shift());
    }
  }

  // --- AUTH (memory sessions) ---
  const sessions = {};
  function createToken() {
    const t = uuidv4();
    sessions[t] = { user: 'admin', expires: Date.now() + 3600_000 }; // 1h
    return t;
  }
  function verifyToken(t) {
    const s = t && sessions[t];
    if (s && s.expires > Date.now()) return s.user;
    if (s) delete sessions[t];
    return null;
  }
  function checkPin(p) {
    const a = Buffer.from(ADMIN_PIN), b = Buffer.from(String(p || '').trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // --- HELPERS ---
  function parseBody(req, max = 2_000_000) {
    return new Promise((resolve, reject) => {
      let b = '', size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > max) { reject(new Error('Payload too large')); req.destroy(); return; }
        b += c.toString();
      });
      req.on('end', () => {
        try {
          const ct = (req.headers['content-type'] || '').toLowerCase();
          if (ct.includes('json')) return resolve(JSON.parse(b || '{}'));
          if (ct.includes('urlencoded')) return resolve(querystring.parse(b));
          try { resolve(JSON.parse(b || '{}')); } catch { resolve({ raw: b }); }
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  function setCORS(req, res) {
    const origin = req.headers.origin || '';
    const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  const submitHits = new Map(), leadHits = new Map();
  function allowHit(map, ip, max = 5, windowMs = 300_000) {
    const now = Date.now();
    const arr = (map.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now); map.set(ip, arr); return true;
  }

  // --- SERVER ---
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

    setCORS(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    // Health
    if (url.pathname === '/' || url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
         .end(JSON.stringify({ ok: true, status: 'running', time: new Date().toISOString() }));
      return;
    }

    // API
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const body = await parseBody(req).catch(()=>({}));
        const pin = body.pin ?? body.PIN ?? body.passcode ?? body.password ?? '';
        if (checkPin(pin)) {
          const token = createToken();
          res.setHeader('Set-Cookie',
            `session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=3600`
          );
          return res.writeHead(200).end(JSON.stringify({ success:true, token }));
        }
        return res.writeHead(401).end(JSON.stringify({ error:'Invalid PIN' }));
      }

      // PUBLIC: live items
      if (url.pathname === '/api/gpts/public' && req.method === 'GET') {
        const db = await readDB();
        const live = (db.items || []).filter(i => i.status === 'live');
        return res.writeHead(200).end(JSON.stringify({ items: live, settings: db.settings }));
      }

      // PUBLIC: submit GPT (pending)
      if (url.pathname === '/api/gpts/submit' && req.method === 'POST') {
        if (!allowHit(submitHits, ip)) return res.writeHead(429).end(JSON.stringify({ error:'Too many submissions' }));
        try {
          const body = await parseBody(req, 2_000_000);
          const { title, url: link, icon='', desc='', categories=[], tags=[] } = body;
          if (!title) return res.writeHead(400).end(JSON.stringify({ error:'Title required' }));
          if (!/^https:\/\/chatgpt\.com\/g\//i.test(String(link||'')))
            return res.writeHead(400).end(JSON.stringify({ error:'ChatGPT link must start with https://chatgpt.com/g/...' }));
          if (icon && !( /^data:image\/(png|jpeg|webp);base64,/i.test(icon) || /^https?:\/\//i.test(icon) ))
            return res.writeHead(400).end(JSON.stringify({ error:'Icon must be http(s) URL or data:image/*;base64' }));

          const db = await readDB();
          db.items.push({
            id: uuidv4(), title, url: link, icon, desc,
            categories: Array.isArray(categories)?categories.slice(0,10):[],
            tags: Array.isArray(tags)?tags.slice(0,20):[],
            featured:false, status:'pending', createdAt:Date.now(), submittedBy: ip
          });
          await writeDB(db);
          return res.writeHead(201).end(JSON.stringify({ success:true }));
        } catch { return res.writeHead(500).end(JSON.stringify({ error:'Server error' })); }
      }

      // PUBLIC: lead submit
      if (url.pathname === '/api/leads/create' && req.method === 'POST') {
        if (!allowHit(leadHits, ip)) return res.writeHead(429).end(JSON.stringify({ error:'Too many submissions' }));
        try {
          const body = await parseBody(req, 10_000);
          const email = String(body.email || '').trim().slice(0,100);
          const message = String(body.message || '').trim().slice(0,500);
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!email || !emailRegex.test(email))
            return res.writeHead(400).end(JSON.stringify({ error:'Invalid email' }));
          const db = await readDB();
          db.leads.unshift({ id: uuidv4(), createdAt: Date.now(), email, message, ip });
          await writeDB(db);
          return res.writeHead(201).end(JSON.stringify({ success:true }));
        } catch { return res.writeHead(500).end(JSON.stringify({ error:'Server error' })); }
      }

      // AUTH (cookie or bearer)
      const authHeader = req.headers['authorization'];
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const cookieTok = (req.headers.cookie || '').split(';')
        .map(s=>s.trim().split('=')).reduce((a,[k,v])=>k==='session'?decodeURIComponent(v):a,null);
      const user = verifyToken(bearer || cookieTok);
      if (!user) return res.writeHead(401).end(JSON.stringify({ error:'Unauthorized' }));

      // Admin: get all (items + leads + settings)
      if (url.pathname === '/api/gpts/all' && req.method === 'GET') {
        const db = await readDB();
        return res.writeHead(200).end(JSON.stringify(db));
      }

      // Optional: mark all seeds live/featured (utility)
      if (url.pathname === '/api/gpts/seed-defaults' && req.method === 'POST') {
        const db = await readDB();
        (db.items||[]).forEach(i => i.status = 'live');
        await writeDB(db);
        return res.writeHead(200).end(JSON.stringify({ success:true, count: db.items.length }));
      }

      // Export leads CSV
      if (url.pathname === '/api/leads/export' && req.method === 'GET') {
        const db = await readDB();
        const leads = db.leads || [];
        const esc = (s='') => `"${String(s).replace(/"/g,'""')}"`;
        const rows = [
          'id,createdAt,email,message,ip',
          ...leads.map(l => [l.id, new Date(l.createdAt||0).toISOString(), l.email, l.message, l.ip].map(esc).join(','))
        ].join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="leads.csv"'
        }).end(rows);
        return;
      }

      // CRUD (create via admin modal, update, delete)
      const db = await readDB();
      if (url.pathname === '/api/gpts/create' && req.method === 'POST') {
        const body = await parseBody(req);
        const item = {
          id: uuidv4(),
          createdAt: Date.now(),
          featured: !!body.featured,
          status: body.status || 'hidden',
          title: String(body.title||'').trim(),
          url: String(body.url||'').trim(),
          icon: String(body.icon||'').trim(),
          desc: String(body.desc||'').trim(),
          categories: Array.isArray(body.categories)?body.categories:[],
          tags: Array.isArray(body.tags)?body.tags:[]
        };
        db.items.unshift(item);
        await writeDB(db);
        return res.writeHead(201).end(JSON.stringify(item));
      }

      if (url.pathname.startsWith('/api/gpts/update/') && req.method === 'PUT') {
        const id = path.basename(url.pathname);
        const patch = await parseBody(req);
        const idx = db.items.findIndex(i=>i.id===id);
        if (idx < 0) return res.writeHead(404).end(JSON.stringify({ error:'Item not found' }));
        db.items[idx] = { ...db.items[idx], ...patch };
        await writeDB(db);
        return res.writeHead(200).end(JSON.stringify(db.items[idx]));
      }

      if (url.pathname.startsWith('/api/gpts/delete/') && req.method === 'DELETE') {
        const id = path.basename(url.pathname);
        const before = db.items.length;
        db.items = db.items.filter(i=>i.id!==id);
        await writeDB(db);
        return res.writeHead(before===db.items.length?404:204).end(before===db.items.length?JSON.stringify({error:'Item not found'}):undefined);
      }

      return res.writeHead(404).end(JSON.stringify({ error:'Route not found' }));
    }

    // Static (dev convenience)
    res.writeHead(404, {'Content-Type':'text/plain'}).end('404 Not Found');
  });

  server.listen(PORT, HOST, () => {
    console.log(`✅ GPTMart server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch(e => console.error('❌ Startup failed:', e));
