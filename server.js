// server.js
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

async function startServer() {
  const { v4: uuidv4 } = await import('uuid');

  // --- CONFIG ---
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0';                 // listen on all interfaces (Render/Fly/etc.)
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR, 'db.json');

  // --- DB HELPERS ---
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch {
      // Seed on first run
      const allGpts = [
        /* … your seeded items … */
        { title:"Bug Meme GPT", desc:"Turns bugs into instant memes.", icon:"https://cdn-icons-png.flaticon.com/512/3221/3221614.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dab3b8cebc819180d1b629ab574579-bug-meme-gpt?model=gpt-5"}
      ];
      const formattedGpts = allGpts.map(item => ({
        id: uuidv4(),
        createdAt: Date.now() - Math.floor(Math.random() * 1_000_000),
        status: 'hidden',
        featured: false,
        title: item.title || item.name,
        desc: item.desc || `A helpful assistant for ${item.name || item.title}.`,
        icon: item.icon,
        categories: item.categories || ["Languages"],
        tags: item.tags || [],
        url: item.url,
      }));
      const defaultData = { settings: { title: "GPTMart" }, items: formattedGpts, leads: [] };
      await writeDB(defaultData);
      return defaultData;
    }
  }

  // --- ATOMIC WRITES W/ QUEUE ---
  let isWriting = false;
  const writeQueue = [];
  async function writeDB(data) {
    if (isWriting) { writeQueue.push(data); return; }
    isWriting = true;
    try {
      const tmpPath = DB_PATH + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
      await fs.rename(tmpPath, DB_PATH); // atomic replace
    } finally {
      isWriting = false;
      if (writeQueue.length > 0) writeDB(writeQueue.shift());
    }
  }

  // --- AUTH (memory) ---
  const sessions = {};
  function createToken(data) {
    const token = uuidv4();
    sessions[token] = { user: data, expires: Date.now() + 3600 * 1000 }; // 1h
    return token;
  }
  function verifyTokenValue(token) {
    const s = token && sessions[token];
    if (s && s.expires > Date.now()) return s.user;
    if (s) delete sessions[token];
    return null;
  }

  // constant-time PIN compare
  function checkPin(supplied) {
    const a = Buffer.from(ADMIN_PIN);
    const b = Buffer.from(String(supplied || '').trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // parse body helper (JSON or form) with size limit
  function parseBody(req, maxBytes = 2_500_000) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { reject(new Error('Payload too large')); req.destroy(); return; }
        body += chunk.toString();
      });
      req.on('end', () => {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        try {
          if (ct.includes('application/json')) resolve(JSON.parse(body || '{}'));
          else if (ct.includes('application/x-www-form-urlencoded')) resolve(querystring.parse(body));
          else { try { resolve(JSON.parse(body || '{}')); } catch { resolve({ raw: body }); } }
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // CORS helper
  function setCORS(req, res) {
    const origin = req.headers.origin || 'https://www.gptmrt.com';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // simple IP rate-limit store for submissions
  const submitHits = new Map();
  function allowSubmit(ip) {
    const now = Date.now(), windowMs = 5 * 60 * 1000, maxHits = 5;
    const arr = (submitHits.get(ip) || []).filter(ts => now - ts < windowMs);
    if (arr.length >= maxHits) return false;
    arr.push(now); submitHits.set(ip, arr);
    return true;
  }
  const leadHits = new Map();
  function allowLeadSubmit(ip) {
    const now = Date.now(), windowMs = 5 * 60 * 1000, maxHits = 5;
    const arr = (leadHits.get(ip) || []).filter(ts => now - ts < windowMs);
    if (arr.length >= maxHits) return false;
    arr.push(now); leadHits.set(ip, arr);
    return true;
  }

  // --- SERVER ---
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    // CORS + preflight
    setCORS(req, res);
    if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

    // Helpful root page
    if (url.pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
         .end('GPTMart connector is running. Try /api/gpts/public or /api/health');
      return;
    }

    // Health
    if (url.pathname === '/api/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }

    // API
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN
      if (url.pathname === '/api/login' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const pin = body.pin ?? body.PIN ?? body.passcode ?? body.password ?? '';
          if (checkPin(pin)) {
            const token = createToken({ user: 'admin' });
            const cookie = [
              `session=${encodeURIComponent(token)}`,
              'HttpOnly', 'Path=/', 'SameSite=None', 'Secure', 'Max-Age=3600'
            ].join('; ');
            res.setHeader('Set-Cookie', cookie);
            res.writeHead(200).end(JSON.stringify({ success: true, token }));
          } else {
            res.writeHead(401).end(JSON.stringify({ error: 'Invalid PIN' }));
          }
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: 'Invalid request body' }));
        }
        return;
      }

      // PUBLIC LIST
      if (url.pathname === '/api/gpts/public' && method === 'GET') {
        const db = await readDB();
        const publicItems = db.items.filter(i => i.status === 'live');
        res.writeHead(200).end(JSON.stringify({ settings: db.settings, items: publicItems }));
        return;
      }

      // PUBLIC LEAD SUBMISSION
      if (url.pathname === '/api/leads/create' && method === 'POST') {
        try {
          const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
          if (!allowLeadSubmit(ip)) { res.writeHead(429).end(JSON.stringify({ error: 'Too many submissions. Try later.' })); return; }
          const body = await parseBody(req, 10_000);
          const email = String(body.email || '').trim().slice(0, 100);
          const message = String(body.message || '').trim().slice(0, 500);
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!email || !emailRegex.test(email)) { res.writeHead(400).end(JSON.stringify({ error:'A valid email is required' })); return; }
          const db = await readDB();
          const lead = { id: uuidv4(), createdAt: Date.now(), email, message, ip };
          if (!db.leads) db.leads = [];
          db.leads.unshift(lead);
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success:true, id:lead.id }));
        } catch (e) {
          console.error('Lead creation error:', e);
          res.writeHead(500).end(JSON.stringify({ error:'Server error' }));
        }
        return;
      }

      // --- AUTH (cookie or bearer) ---
      const authHeader = req.headers['authorization'];
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const cookieHeader = req.headers.cookie || '';
      const cookieTok = cookieHeader.split(';').map(s => s.trim())
        .map(kv => kv.split('='))
        .reduce((acc,[k,v]) => (k==='session' ? decodeURIComponent(v||'') : acc), null);
      const user = verifyTokenValue(bearer || cookieTok);
      if (!user) { res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return; }

      // --- ADMIN ROUTES ---
      const db = await readDB();

      if (url.pathname === '/api/gpts/all' && method === 'GET') {
        // returns items + settings + (now also) leads
        res.writeHead(200).end(JSON.stringify(db));
        return;
      }

      // NEW: leads listing (auth)
      if (url.pathname === '/api/leads' && method === 'GET') {
        res.writeHead(200).end(JSON.stringify({ items: db.leads || [] }));
        return;
      }

      // OPTIONAL: delete a lead
      if (url.pathname.startsWith('/api/leads/delete/') && method === 'DELETE') {
        const id = path.basename(url.pathname);
        const before = (db.leads || []).length;
        db.leads = (db.leads || []).filter(l => l.id !== id);
        if (db.leads.length < before) { await writeDB(db); res.writeHead(204).end(); }
        else { res.writeHead(404).end(JSON.stringify({ error:'Lead not found' })); }
        return;
      }

      // Items CRUD
      let body = '';
      req.on('data', chunk => (body += chunk.toString()));
      req.on('end', async () => {
        try {
          if (url.pathname === '/api/gpts/create' && method === 'POST') {
            const newItem = JSON.parse(body || '{}');
            newItem.id = uuidv4();
            newItem.createdAt = Date.now();
            db.items.unshift(newItem);
            await writeDB(db);
            res.writeHead(201).end(JSON.stringify(newItem));
          } else if (url.pathname.startsWith('/api/gpts/update/') && method === 'PUT') {
            const id = path.basename(url.pathname);
            const updatedData = JSON.parse(body || '{}');
            const idx = db.items.findIndex(i => i.id === id);
            if (idx > -1) {
              db.items[idx] = { ...db.items[idx], ...updatedData };
              await writeDB(db);
              res.writeHead(200).end(JSON.stringify(db.items[idx]));
            } else {
              res.writeHead(404).end(JSON.stringify({ error: 'Item not found' }));
            }
          } else if (url.pathname.startsWith('/api/gpts/delete/') && method === 'DELETE') {
            const id = path.basename(url.pathname);
            const initial = db.items.length;
            db.items = db.items.filter(i => i.id !== id);
            if (db.items.length < initial) { await writeDB(db); res.writeHead(204).end(); }
            else { res.writeHead(404).end(JSON.stringify({ error: 'Item not found' })); }
          } else {
            res.writeHead(404).end(JSON.stringify({ error: 'API route not found' }));
          }
        } catch {
          res.writeHead(500).end(JSON.stringify({ error: 'Server error' }));
        }
      });
      return;
    }

    // Static files (for local testing)
    try {
      // very small hardening: prevent path traversal
      const safe = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(__dirname, safe === '/' ? 'index.html' : safe);
      const data = await fs.readFile(filePath);
      let contentType = 'text/html; charset=utf-8';
      if (filePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
      else if (filePath.endsWith('.css')) contentType = 'text/css; charset=utf-8';
      else if (filePath.endsWith('.json')) contentType = 'application/json; charset=utf-8';
      else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';
      else if (filePath.endsWith('.png')) contentType = 'image/png';
      else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) contentType = 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.writeHead(200).end(data);
    } catch {
      res.writeHead(404).end('<h1>404 Not Found</h1>');
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}/`);
  });
}

startServer().catch(err => console.error('Failed to start server:', err));
