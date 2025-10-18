// server.js
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

// --- ASYNC BOOTSTRAP ---
async function startServer() {
  const { v4: uuidv4 } = await import('uuid');

  // --- CONFIG ---
  const PORT = process.env.PORT || 3000;
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR, 'db.json');
  const LEADS_PATH = path.join(DATA_DIR, 'leads.json');

  // ---------- JSON helpers (atomic) ----------
  async function readJSON(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { await fs.writeFile(file, JSON.stringify(fallback, null, 2)); return fallback; }
  }
  async function writeJSON(file, data) {
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  }

  // ---------- DB HELPERS ----------
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch {
      const defaultData = { settings: { title: "GPTMart" }, items: [] };
      await writeJSON(DB_PATH, defaultData);
      return defaultData;
    }
  }
  async function writeDB(data) { await writeJSON(DB_PATH, data); }

  // ---------- AUTH (memory) ----------
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
  function checkPin(supplied) {
    const a = Buffer.from(ADMIN_PIN);
    const b = Buffer.from(String(supplied || '').trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // ---------- Body parsing ----------
  function parseBody(req, maxBytes = 2_500_000) {
    return new Promise((resolve, reject) => {
      let body = ''; let size = 0;
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

  // ---------- CORS ----------
  function setCORS(req, res) {
    const origin = req.headers.origin || 'https://www.gptmrt.com';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // simple IP rate-limit store for /api/gpts/submit
  const submitHits = new Map();
  function allowSubmit(ip) {
    const now = Date.now(), windowMs = 5 * 60 * 1000, maxHits = 5;
    const arr = (submitHits.get(ip) || []).filter(ts => now - ts < windowMs);
    if (arr.length >= maxHits) return false;
    arr.push(now); submitHits.set(ip, arr);
    return true;
  }

  // ---------- SERVER ----------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    setCORS(req, res);
    if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

    // Root / health
    if (url.pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
         .end('GPTMart connector is running. Try /api/gpts/public or /api/health');
      return;
    }
    if (url.pathname === '/api/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true })); return;
    }

    // --------------- API ----------------
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN -> returns token + cookie (works with existing admin.html)
      if (url.pathname === '/api/login' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const pin = body.pin ?? body.PIN ?? body.passcode ?? body.password ?? '';
          if (!checkPin(pin)) { res.writeHead(401).end(JSON.stringify({ error: 'Invalid PIN' })); return; }
          const token = createToken({ user: 'admin' });
          res.setHeader('Set-Cookie', [
            `session=${encodeURIComponent(token)}`,
            'HttpOnly','Path=/','SameSite=None','Secure','Max-Age=3600'
          ].join('; '));
          res.writeHead(200).end(JSON.stringify({ success: true, token }));
        } catch { res.writeHead(400).end(JSON.stringify({ error: 'Invalid request body' })); }
        return;
      }

      // PUBLIC GPT LIST (unchanged)
      if (url.pathname === '/api/gpts/public' && method === 'GET') {
        const db = await readDB();
        const publicItems = db.items.filter(i => i.status === 'live');
        res.writeHead(200).end(JSON.stringify({ settings: db.settings, items: publicItems }));
        return;
      }

      // PUBLIC SUBMIT (unchanged)
      if (url.pathname === '/api/gpts/submit' && method === 'POST') {
        try {
          const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
          if (!allowSubmit(ip)) { res.writeHead(429).end(JSON.stringify({ error: 'Too many submissions. Try later.' })); return; }

          const body = await parseBody(req, 2_500_000);
          const title = String(body.title || '').trim().slice(0, 120);
          const urlStr = String(body.url || '').trim().slice(0, 1000);
          const icon = String(body.icon || '').trim().slice(0, 1_500_000);
          const desc = String(body.desc || '').trim().slice(0, 800);
          const categories = Array.isArray(body.categories) ? body.categories.slice(0, 10).map(s=>String(s).trim().slice(0,40)) : [];
          const tags = Array.isArray(body.tags) ? body.tags.slice(0, 20).map(s=>String(s).trim().slice(0,32)) : [];

          if (!title) { res.writeHead(400).end(JSON.stringify({ error:'Title is required' })); return; }
          if (!/^https:\/\/chatgpt\.com\/g\//i.test(urlStr)) { res.writeHead(400).end(JSON.stringify({ error:'ChatGPT link must start with https://chatgpt.com/g/...' })); return; }
          if (icon && !(/^data:image\/(png|jpeg|webp);base64,/i.test(icon) || /^https?:\/\//i.test(icon))) {
            res.writeHead(400).end(JSON.stringify({ error:'Icon must be an http(s) URL or data:image/*;base64 URL' })); return;
          }

          const db = await readDB();
          const item = {
            id: uuidv4(),
            title, url: urlStr, icon, desc,
            categories, tags,
            featured: false,
            status: 'pending',
            createdAt: Date.now(),
            submittedBy: ip
          };
          db.items.push(item);
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success:true, id:item.id }));
        } catch {
          res.writeHead(500).end(JSON.stringify({ error:'Server error' }));
        }
        return;
      }

      // -------- LEADS (NEW) ----------
      if (url.pathname === '/api/leads' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const email = String(body.email || '').trim();
          const message = String(body.message || '').trim();
          const name = String(body.name || '').trim();
          if (!email || !message) { res.writeHead(400).end(JSON.stringify({ error: 'Email and message required' })); return; }
          const leads = await readJSON(LEADS_PATH, []);
          leads.push({
            id: uuidv4(),
            email, name, message,
            ua: body.ua || req.headers['user-agent'] || '',
            tz: body.tz || '',
            createdAt: Date.now()
          });
          await writeJSON(LEADS_PATH, leads);
          res.writeHead(201).end(JSON.stringify({ ok: true }));
        } catch (e) {
          console.error(e); res.writeHead(500).end(JSON.stringify({ error: 'Server error' }));
        }
        return;
      }

      if (url.pathname === '/api/leads' && method === 'GET') {
        // Accept Bearer or cookie session
        const authHeader = req.headers['authorization'];
        const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const cookieHeader = req.headers.cookie || '';
        const cookieTok = cookieHeader.split(';').map(s=>s.trim()).map(kv=>kv.split('='))
          .reduce((acc,[k,v]) => (k==='session' ? decodeURIComponent(v||'') : acc), null);
        const user = verifyTokenValue(bearer || cookieTok);
        if (!user) { res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return; }
        const leads = await readJSON(LEADS_PATH, []);
        res.writeHead(200).end(JSON.stringify({ items: leads }));
        return;
      }
      // ------ end LEADS -------

      // If you have other admin routes below, they remain unchanged …

      res.writeHead(404).end(JSON.stringify({ error: 'API route not found' }));
      return;
    }

    // -------- Static files --------
    try {
      const filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
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

  server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
  });
}

startServer().catch(err => console.error('Failed to start server:', err));
