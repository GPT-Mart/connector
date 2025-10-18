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
  const HOST = '0.0.0.0';
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR, 'db.json');

  // EXACT front-end origins you serve from
  const ORIGIN_WHITELIST = new Set([
    'https://www.gptmrt.com',
    'https://gptmrt.com',
    'https://connector.onrender.com', // your Render URL if you ever embed admin locally
    'http://localhost:3000',
    'http://localhost:5173',
  ]);

  function setCORS(req, res) {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && ORIGIN_WHITELIST.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      // safe default to primary site (and still allow direct calls)
      res.setHeader('Access-Control-Allow-Origin', 'https://www.gptmrt.com');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  // --- SEED GP TS (same list as before; trimmed here for brevity) ---
  const SEED_GPTS = [
    { title:"jQuery Tutor", desc:"Learn and master jQuery: selectors, events, animations, DOM, AJAX, plugins, debugging, and modern alternatives.", icon:"https://www.vectorlogo.zone/logos/jquery/jquery-icon.svg", categories:["Frontend","Tools"], url:"https://chatgpt.com/g/g-68b859c4f6f88191b05a4effe7d2140a-jquery-tutor"},
    { title:"ASP Tutor", desc:"Classic ASP + modern ASP.NET (C#). Server-side scripting, examples, debugging, and web app best practices.", icon:"https://cdn.iconscout.com/icon/free/png-256/asp-net-3-1175185.png", categories:["Backend","Languages"], url:"https://chatgpt.com/g/g-68b6eaad79e48191b3b2c487f0e60071-asp-tutor?model=gpt-5"},
    { title:"Artificial Intelligence Mentor", desc:"ML, DL, NLP, CV, RL, and Generative AI. Runnable code, projects, and ethics — beginner to advanced.", icon:"https://upload.wikimedia.org/wikipedia/commons/b/b9/AI_logo_by_United_Blasters.png", categories:["AI & Automation","Data"], url:"https://chatgpt.com/g/g-68b6e97f95ac81918b262e088c05f522-artificial-intelligence-mentor"},
    // ... keep the rest of your full list exactly as you posted ...
    { title:"Bug Meme GPT", desc:"Turns bugs into instant memes.", icon:"https://cdn-icons-png.flaticon.com/512/3221/3221614.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dab3b8cebc819180d1b629ab574579-bug-meme-gpt?model=gpt-5"}
  ];

  // --- DB HELPERS ---
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch {
      const formatted = SEED_GPTS.map(item => ({
        id: uuidv4(),
        createdAt: Date.now() - Math.floor(Math.random() * 1000000),
        status: 'hidden',
        featured: false,
        title: item.title,
        desc: item.desc,
        icon: item.icon,
        categories: item.categories || ["Languages"],
        tags: item.tags || [],
        url: item.url,
      }));
      const defaultData = { settings: { title: "GPTMart" }, items: formatted, leads: [] };
      await writeDB(defaultData);
      return defaultData;
    }
  }

  let isWriting = false;
  const writeQueue = [];
  async function writeDB(data) {
    if (isWriting) { writeQueue.push(data); return; }
    isWriting = true;
    try {
      const tmp = DB_PATH + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, DB_PATH);
    } finally {
      isWriting = false;
      if (writeQueue.length > 0) writeDB(writeQueue.shift());
    }
  }

  // --- AUTH (in-memory) ---
  const sessions = {};
  function createToken(data) {
    const token = uuidv4();
    sessions[token] = { user: data, expires: Date.now() + 3600 * 1000 };
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

  // --- simple rate limits ---
  const submitHits = new Map();
  const leadHits = new Map();
  function allowHit(map, ip, maxHits = 5, windowMs = 5 * 60 * 1000) {
    const now = Date.now();
    const arr = (map.get(ip) || []).filter(ts => now - ts < windowMs);
    if (arr.length >= maxHits) return false;
    arr.push(now); map.set(ip, arr);
    return true;
  }

  // --- SERVER ---
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    setCORS(req, res);
    if (method === 'OPTIONS') { res.writeHead(204).end(); return; }

    if (url.pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('GPTMart connector is running. Try /api/gpts/public or /api/health');
      return;
    }

    if (url.pathname === '/api/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN → returns bearer token and also sets cookie for same-site cases
      if (url.pathname === '/api/login' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const pin = body.pin ?? body.PIN ?? body.passcode ?? body.password ?? '';
          if (checkPin(pin)) {
            const token = createToken({ user: 'admin' });
            const cookie = [
              `session=${encodeURIComponent(token)}`,
              'HttpOnly',
              'Path=/',
              'SameSite=None',
              'Secure',
              'Max-Age=3600'
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

      // LOGOUT (for good measure)
      if (url.pathname === '/api/logout' && method === 'POST') {
        res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0');
        res.writeHead(204).end();
        return;
      }

      // PUBLIC: live items
      if (url.pathname === '/api/gpts/public' && method === 'GET') {
        const db = await readDB();
        const publicItems = (db.items || []).filter(i => i.status === 'live');
        res.writeHead(200).end(JSON.stringify({ settings: db.settings, items: publicItems }));
        return;
      }

      // PUBLIC: leads
      if (url.pathname === '/api/leads/create' && method === 'POST') {
        try {
          const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
          if (!allowHit(leadHits, ip)) { res.writeHead(429).end(JSON.stringify({ error: 'Too many submissions. Try later.' })); return; }
          const body = await parseBody(req, 10000);
          const email = String(body.email || '').trim().slice(0, 100);
          const message = String(body.message || '').trim().slice(0, 500);
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!email || !emailRegex.test(email)) {
            res.writeHead(400).end(JSON.stringify({ error: 'A valid email is required' })); return;
          }
          const db = await readDB();
          const lead = { id: uuidv4(), createdAt: Date.now(), email, message, ip };
          db.leads = db.leads || [];
          db.leads.unshift(lead);
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success: true, id: lead.id }));
        } catch (e) {
          console.error('Lead creation error:', e);
          res.writeHead(500).end(JSON.stringify({ error: 'Server error' }));
        }
        return;
      }

      // PUBLIC: submit GPT (pending)
      if (url.pathname === '/api/gpts/submit' && method === 'POST') {
        try {
          const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
          if (!allowHit(submitHits, ip)) { res.writeHead(429).end(JSON.stringify({ error: 'Too many submissions. Try later.' })); return; }

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
          const item = { id: uuidv4(), title, url: urlStr, icon, desc, categories, tags, featured: false, status: 'pending', createdAt: Date.now(), submittedBy: ip };
          db.items.push(item);
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success:true, id:item.id }));
        } catch {
          res.writeHead(500).end(JSON.stringify({ error:'Server error' }));
        }
        return;
      }

      // --- ADMIN AUTH (Bearer or cookie) ---
      const authHeader = req.headers['authorization'];
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const cookieHeader = req.headers.cookie || '';
      const cookieTok = cookieHeader.split(';').map(s => s.trim()).map(kv => kv.split('=')).reduce((acc,[k,v]) => (k==='session' ? decodeURIComponent(v||'') : acc), null);
      const user = verifyTokenValue(bearer || cookieTok);
      if (!user) { res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return; }

      const db = await readDB();

      if (url.pathname === '/api/gpts/all' && method === 'GET') {
        res.writeHead(200).end(JSON.stringify(db));
        return;
      }

      if (url.pathname === '/api/leads/export' && method === 'GET') {
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

      if (url.pathname === '/api/gpts/seed-defaults' && method === 'POST') {
        const body = await parseBody(req).catch(()=>({}));
        const desiredStatus = (body.status || 'live').toLowerCase();
        const desiredFeatured = !!body.featured;
        const byUrl = new Map((db.items || []).map(i => [i.url, i]));
        let added = 0;
        for (const s of SEED_GPTS) {
          if (!byUrl.has(s.url)) {
            const item = { id: uuidv4(), createdAt: Date.now(), status: desiredStatus, featured: desiredFeatured, title: s.title, desc: s.desc, icon: s.icon, categories: s.categories || [], tags: s.tags || [], url: s.url };
            db.items.unshift(item); added++;
          }
        }
        await writeDB(db);
        res.writeHead(201).end(JSON.stringify({ success: true, added }));
        return;
      }

      // CRUD
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
            if (db.items.length < initial) {
              await writeDB(db);
              res.writeHead(204).end();
            } else {
              res.writeHead(404).end(JSON.stringify({ error: 'Item not found' }));
            }
          } else {
            res.writeHead(404).end(JSON.stringify({ error: 'API route not found' }));
          }
        } catch {
          res.writeHead(500).end(JSON.stringify({ error: 'Server error' }));
        }
      });
      return;
    }

    // Static files (local testing)
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

  function parseBody(req, maxBytes = 2_500_000) {
    return new Promise((resolve, reject) => {
      let body = '', size = 0;
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

  server.listen(PORT, HOST, () => {
    console.log(`✅ Server running at http://${HOST}:${PORT}/`);
  });
}

startServer().catch(err => console.error('Failed to start server:', err));
