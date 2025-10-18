// server.js — GPTMart Connector (v3)
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

async function startServer() {
  const { v4: uuidv4 } = await import('uuid');
  const PORT = process.env.PORT || 3000;
  const HOST = '0.0.0.0';
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR, 'db.json');

  // === DB helpers ===
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      const json = JSON.parse(data);
      if (!json.items) json.items = [];
      if (!json.leads) json.leads = [];
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
    if (writing) return queue.push(data);
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

  // === Auth ===
  const sessions = {};
  function createToken() {
    const t = uuidv4();
    sessions[t] = { user: 'admin', expires: Date.now() + 3600_000 };
    return t;
  }
  function verifyToken(t) {
    const s = sessions[t];
    if (s && s.expires > Date.now()) return s.user;
    if (s) delete sessions[t];
    return null;
  }
  function checkPin(p) {
    const a = Buffer.from(ADMIN_PIN), b = Buffer.from(String(p || '').trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // === Helpers ===
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
    const allowed = ['https://www.gptmrt.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
    res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0]);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  const submitHits = new Map(), leadHits = new Map();
  function allowHit(map, ip, max = 5, windowMs = 300_000) {
    const now = Date.now(), arr = (map.get(ip) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now); map.set(ip, arr); return true;
  }

  // === Server ===
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    setCORS(req, res);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    // health
    if (url.pathname === '/' || url.pathname === '/api/health') {
      res.writeHead(200, {'Content-Type':'application/json'})
         .end(JSON.stringify({ ok: true, status: 'running', time: new Date().toISOString() }));
      return;
    }

    // === API ===
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const body = await parseBody(req).catch(()=>({}));
        if (checkPin(body.pin)) {
          const token = createToken();
          res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=3600`);
          return res.writeHead(200).end(JSON.stringify({ success:true, token }));
        }
        return res.writeHead(401).end(JSON.stringify({ error:'Invalid PIN' }));
      }

      // PUBLIC GPTS
      if (url.pathname === '/api/gpts/public' && req.method === 'GET') {
        const db = await readDB();
        const live = db.items.filter(i => i.status === 'live');
        return res.writeHead(200).end(JSON.stringify({ items: live, settings: db.settings }));
      }

      // PUBLIC SUBMIT GPT
      if (url.pathname === '/api/gpts/submit' && req.method === 'POST') {
        if (!allowHit(submitHits, ip)) return res.writeHead(429).end(JSON.stringify({ error:'Too many submissions' }));
        try {
          const body = await parseBody(req, 2_000_000);
          const { title, url: link, icon, desc, categories=[], tags=[] } = body;
          if (!title || !/^https:\/\/chatgpt\.com\/g\//.test(link))
            return res.writeHead(400).end(JSON.stringify({ error:'Invalid title or link' }));
          const db = await readDB();
          db.items.push({
            id: uuidv4(), title, url: link, icon, desc, categories, tags,
            featured:false, status:'pending', createdAt:Date.now()
          });
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success:true }));
        } catch { res.writeHead(500).end(JSON.stringify({ error:'Server error' })); }
        return;
      }

      // PUBLIC LEAD SUBMIT
      if (url.pathname === '/api/leads/create' && req.method === 'POST') {
        if (!allowHit(leadHits, ip)) return res.writeHead(429).end(JSON.stringify({ error:'Too many submissions' }));
        try {
          const body = await parseBody(req, 10_000);
          const email = String(body.email || '').trim();
          const message = String(body.message || '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.writeHead(400).end(JSON.stringify({ error:'Invalid email' }));
          const db = await readDB();
          db.leads.unshift({ id: uuidv4(), createdAt: Date.now(), email, message, ip });
          await writeDB(db);
          res.writeHead(201).end(JSON.stringify({ success:true }));
        } catch { res.writeHead(500).end(JSON.stringify({ error:'Server error' })); }
        return;
      }

      // PUBLIC LEADS LIST (auth)
      if (url.pathname === '/api/leads/all' && req.method === 'GET') {
        const cookieTok = (req.headers.cookie || '').split(';').map(x=>x.trim().split('='))
          .reduce((a,[k,v])=>k==='session'?decodeURIComponent(v):a,null);
        const user = verifyToken(cookieTok);
        if (!user) return res.writeHead(401).end(JSON.stringify({ error:'Unauthorized' }));
        const db = await readDB();
        return res.writeHead(200).end(JSON.stringify({ items: db.leads || [] }));
      }

      // AUTH routes
      const cookieTok = (req.headers.cookie || '').split(';').map(x=>x.trim().split('='))
        .reduce((a,[k,v])=>k==='session'?decodeURIComponent(v):a,null);
      const user = verifyToken(cookieTok);
      if (!user) return res.writeHead(401).end(JSON.stringify({ error:'Unauthorized' }));

      const db = await readDB();

      if (url.pathname === '/api/gpts/all' && req.method === 'GET') {
        return res.writeHead(200).end(JSON.stringify(db));
      }

      if (url.pathname === '/api/gpts/seed-defaults' && req.method === 'POST') {
        const data = await readDB();
        data.items.forEach(i => i.status='live');
        await writeDB(data);
        return res.writeHead(200).end(JSON.stringify({ success:true, count:data.items.length }));
      }

      // update / delete
      const id = path.basename(url.pathname);
      if (url.pathname.startsWith('/api/gpts/update/') && req.method === 'PUT') {
        const body = await parseBody(req);
        const idx = db.items.findIndex(i=>i.id===id);
        if (idx<0) return res.writeHead(404).end(JSON.stringify({ error:'Not found' }));
        db.items[idx] = { ...db.items[idx], ...body };
        await writeDB(db);
        return res.writeHead(200).end(JSON.stringify(db.items[idx]));
      }
      if (url.pathname.startsWith('/api/gpts/delete/') && req.method === 'DELETE') {
        db.items = db.items.filter(i=>i.id!==id);
        await writeDB(db);
        return res.writeHead(204).end();
      }

      return res.writeHead(404).end(JSON.stringify({ error:'Route not found' }));
    }

    res.writeHead(404, {'Content-Type':'text/plain'}).end('404 Not Found');
  });

  server.listen(PORT, HOST, ()=>console.log(`✅ GPTMart server running at http://${HOST}:${PORT}`));
}

startServer().catch(e => console.error('❌ Startup failed:', e));
