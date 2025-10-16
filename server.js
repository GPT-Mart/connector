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
  const DB_PATH = path.join(__dirname, 'db.json');

  // --- DB HELPERS ---
  async function readDB() {
    try {
      const data = await fs.readFile(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      // Seed on first run
      const allGpts = [
        { title:"jQuery Tutor", desc:"Learn and master jQuery: selectors, events, animations, DOM, AJAX, plugins, debugging, and modern alternatives.", icon:"https://www.vectorlogo.zone/logos/jquery/jquery-icon.svg", categories:["Frontend","Tools"], url:"https://chatgpt.com/g/g-68b859c4f6f88191b05a4effe7d2140a-jquery-tutor"},
        { title:"ASP Tutor", desc:"Classic ASP + modern ASP.NET (C#). Server-side scripting, examples, debugging, and web app best practices.", icon:"https://cdn.iconscout.com/icon/free/png-256/asp-net-3-1175185.png", categories:["Backend","Languages"], url:"https://chatgpt.com/g/g-68b6eaad79e48191b3b2c487f0e60071-asp-tutor?model=gpt-5"},
        { title:"Artificial Intelligence Mentor", desc:"ML, DL, NLP, CV, RL, and Generative AI. Runnable code, projects, and ethics — beginner to advanced.", icon:"https://upload.wikimedia.org/wikipedia/commons/b/b9/AI_logo_by_United_Blasters.png", categories:["AI & Automation","Data"], url:"https://chatgpt.com/g/g-68b6e97f95ac81918b262e088c05f522-artificial-intelligence-mentor"},
        { title:"Sass Tutor", desc:"Master Sass/SCSS: variables, mixins, nesting, partials, imports, architecture. Real-world patterns and debugging.", icon:"https://cdn.iconscout.com/icon/free/png-256/sass-226059.png", categories:["Frontend","Design"], url:"https://chatgpt.com/g/g-68b6e8bf3d7881919c484523463fa967-sass-tutor?model=gpt-5"},
        { title:"Vue Tutor", desc:"Vue components, props, events, router, Pinia/Vuex, Composition API, API integration.", icon:"https://upload.wikimedia.org/wikipedia/commons/9/95/Vue.js_Logo_2.svg", categories:["Frontend","Frameworks"], url:"https://chatgpt.com/g/g-68b6e70822048191a981d4994078c447-vue-tutor"},
        { title:"Gen AI Mentor", desc:"LLMs, diffusion/GANs, audio/video models. Code, projects, and ethics — beginner to advanced.", icon:"https://miro.medium.com/v2/resize:fit:720/format:webp/1*vYurT8Cw7upWSOLJvUo0Mg.png", categories:["AI & Automation"], url:"https://chatgpt.com/g/g-68b6e5d5c7e08191ab8f644e7c87501f-gen-ai-mentor?model=gpt-5"},
        { title:"SciPy Tutor", desc:"Optimization, linear algebra, signal processing, integration, interpolation, statistics — with examples.", icon:"https://upload.wikimedia.org/wikipedia/commons/b/b2/SCIPY_2.svg", categories:["Data","AI & Automation"], url:"https://chatgpt.com/g/g-68b6e4f4f8d081918945af5baad8eb97-scipy-tutor"},
        { title:"Cybersecurity Mentor", desc:"Network security, encryption, ethical hacking basics, malware, risk, and best practices. Lessons + simulations.", icon:"https://cdn-icons-png.flaticon.com/512/3063/3063468.png", categories:["Security"], url:"https://chatgpt.com/g/g-68b6e41946448191af4377ad84dafe24-cybersecurity-mentor"},
        { title:"Data Science Mentor", desc:"NumPy, Pandas, Matplotlib, scikit-learn. Tutorials, datasets, projects — beginner to advanced.", icon:"https://cdn-icons-png.flaticon.com/512/2967/2967262.png", categories:["Data","AI & Automation"], url:"https://chatgpt.com/g/g-68b6a06e44e881919c09ff648d64b0f3-data-science-mentor"},
        { title:"Introduction to Programming", desc:"Start coding from zero. Variables, loops, functions. Python by default, C++/Java/JS optional.", icon:"https://cdn-icons-png.flaticon.com/512/1005/1005141.png", categories:["Learning","Languages"], url:"https://chatgpt.com/g/g-68b69ed77aec81919d3393e367baf046-introduction-to-programming"},
        { title:"DSA Coach", desc:"Concepts, patterns, checklists, complexities, tests, multiple approaches. Python/C++/Java/JS.", icon:"https://cdn-icons-png.flaticon.com/512/5903/5903823.png", categories:["Learning","Interviews"], url:"https://chatgpt.com/g/g-68b69c9ea8d081918fb91d37f78ec3c3-dsa-coach"},
        { title:"Responsive UI Coach (Bootstrap-ready)", desc:"Accessible components & pages. v3/v4→v5, utilities, fixes, CDN or npm/Sass.", icon:"https://cdn.iconscout.com/icon/free/png-256/bootstrap-226077.png", categories:["Frontend","Design"], url:"https://chatgpt.com/g/g-68b697b5913c81918e64a23a52138255-responsive-ui-coach-bootstrap-ready"},
        { title:"Sedative", desc:"Talk to me to sleep. no cap.", icon:"https://cdn-icons-png.flaticon.com/512/3223/3223652.png", categories:["Lifestyle"], url:"https://chatgpt.com/g/g-688363b4125c8191bb950c37778ab4d0-sedative?model=gpt-4o"},
        { title:"Global Football Hub", desc:"ESPN FC, UEFA, Transfermarkt, FIFA, FBref. News, tables, verified info.", icon:"https://cdn-icons-png.flaticon.com/512/280/280766.png", categories:["Sports"], url:"https://chatgpt.com/g/g-6878f74104908191b0ae0f9a513c392b-global-football-hub?model=gpt-4o"},
        { title:"Freeware finder", desc:"Find quality free software/services fast.", icon:"https://cdn-icons-png.flaticon.com/512/3223/3223652.png", categories:["Search","Tools"], url:"https://chatgpt.com/g/g-6873b6d56ae0819192702a6ab83a9006-freeware-finder?model=gpt-4o"},
        { title:"Blasphemy -- Holy Heresy,Divine Rebellion", desc:"Explore controversial, sacred, and forbidden ideas — religion, philosophy, truth beyond tradition.", icon:"https://upload.wikimedia.org/wikipedia/commons/4/41/Blasphemous_logo.png", categories:["Philosophy"], url:"https://chatgpt.com/g/g-68652a058b348191ba363415dda6bf23-blasphemy-holy-heresy-divine-rebellion?model=gpt-4o"},
        { title:"Spam & Scam Detector – Protect Your Inbox", desc:"Detect scams, spam, phishing in email/SMS/DMs. AI-powered protection.", icon:"https://cdn-icons-png.flaticon.com/512/2926/2926715.png", categories:["Security","Tools"], url:"https://chatgpt.com/g/g-686522599f78819196f796d8f20dc5a7-spam-scam-detector-protect-your-inbox?model=gpt-4o"},
        { title:"Error Detector – Spot, Explain, Fix", desc:"Bugs in code, grammar flaws, logic errors, factual inaccuracies. Detect, explain, fix.", icon:"https://cdn-icons-png.flaticon.com/512/1055/1055673.png", categories:["Tools"], url:"https://chatgpt.com/g/g-68651a7bd7a081919b9e95ed139b1d4c-error-detector-spot-explain-fix?model=gpt-4o"},
        { title:"Lisp/Scheme", desc:"Harness Lisp’s legendary power for AI and elegant computation.", icon:"https://upload.wikimedia.org/wikipedia/commons/4/48/Lisp_logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67efc6a389cc8191a9a54ed9633c8d9c-lisp-scheme"},
        { title:"PowerShell", desc:"Scripting, Windows automation, admin tasks, WMI, AD — pro-grade helper.", icon:"https://upload.wikimedia.org/wikipedia/commons/a/a1/Powershell_128.svg", categories:["Languages","Automation"], url:"https://chatgpt.com/g/g-67efc250595c81918bf818005ac8dded-powershell?model=gpt-5"},
        { title:"Perl", desc:"Regex, parsing, automation, modules — for devs, analysts, and sysadmins.", icon:"https://upload.wikimedia.org/wikipedia/commons/3/34/Perl-logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67efc0f669848191bb17090ea0ac5aab-perl?model=gpt-4o"},
        { title:"Bash", desc:"Automate tasks, scripts, terminal mastery — loops, cron, file ops.", icon:"https://upload.wikimedia.org/wikipedia/commons/5/52/Bash-tip.svg", categories:["Languages","Automation"], url:"https://chatgpt.com/g/g-67efbf3da2048191b28d875c2c041130-bash?model=gpt-4o"},
        { title:"MATLAB", desc:"Matrix math, simulations, analysis, toolboxes, debugging — for students and pros.", icon:"https://upload.wikimedia.org/wikipedia/commons/2/21/Matlab_Logo.png", categories:["Languages","Data"], url:"https://chatgpt.com/g/g-67efbdf8604c8191b48f2596faa7c13a-matlab"},
        { title:"Julia", desc:"High-performance Julia for scientific computing and data science.", icon:"https://upload.wikimedia.org/wikipedia/commons/a/ae/Julia_logo_circles.svg", categories:["Languages","Data"], url:"https://chatgpt.com/g/g-67efbca1eb9481919f6d08d23dcdd14e-julia"},
        { title:"TypeScript", desc:"Types, interfaces, generics, debugging. Ideal for React/Node/full-stack.", icon:"https://upload.wikimedia.org/wikipedia/commons/4/4c/Typescript_logo_2020.svg", categories:["Languages","Frontend"], url:"https://chatgpt.com/g/g-67efb97be07c8191b266b92f5e095c99-typescript"},
        { title:"Rust", desc:"Ownership, lifetimes, crates, zero-cost abstractions — fearless systems dev.", icon:"https://upload.wikimedia.org/wikipedia/commons/d/d5/Rust_programming_language_black_logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef6d3bd4d081919fb3b0cec36e487a-rust"},
        { title:"Kotlin", desc:"Android, backend, multiplatform. Coroutines, Jetpack, OOP, clean architecture.", icon:"https://upload.wikimedia.org/wikipedia/commons/3/3d/Kotlin_icon_%282016-2021%29.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef6bda03888191a399bb2ec8dddb80-kotlin"},
        { title:"Ruby", desc:"Scripts, automation, web (Rails), debugging. For beginners to ninjas.", icon:"https://upload.wikimedia.org/wikipedia/commons/7/73/Ruby_logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef69f3d4488191b55dd9d6fa0b5b4a-ruby"},
        { title:"C#", desc:".NET, Unity, OOP, LINQ, async. Build games, apps, enterprise systems.", icon:"https://upload.wikimedia.org/wikipedia/commons/b/bd/Logo_C_sharp.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef690a075c8191a17713ad997799ff-c"},
        { title:"C", desc:"Syntax, pointers, memory, performance — efficient low-level code.", icon:"https://upload.wikimedia.org/wikipedia/commons/1/18/C_Programming_Language.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef67c3b83481918336d1c4ddfd5600-c"},
        { title:"SQL", desc:"Queries, joins, indexing, optimization, schema design — beginner to pro.", icon:"https://upload.wikimedia.org/wikipedia/commons/d/d7/Sql_data_base_with_logo.svg", categories:["Data"], url:"https://chatgpt.com/g/g-67ef62fdcdd081918ce75b1c878f43f4-sql"},
        { title:"GO (Golang)", desc:"APIs, microservices, CLIs — fast, concurrent, idiomatic Go.", icon:"https://upload.wikimedia.org/wikipedia/commons/0/05/Go_Logo_Blue.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef61ba9f588191bf95969b202cbb40-go-golang"},
        { title:"R", desc:"Tidyverse, ggplot2, ML, research workflows — for analysts and researchers.", icon:"https://upload.wikimedia.org/wikipedia/commons/1/1b/R_logo.svg", categories:["Languages","Data"], url:"https://chatgpt.com/g/g-67ef6038ca98819185f6220127732863-r"},
        { title:"Swift", desc:"Swift & SwiftUI for Apple platforms. Animations, APIs, UI design.", icon:"https://cdn.worldvectorlogo.com/logos/swift-15.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef5efbde6c8191b42c15244c8a1a78-swift?model=gpt-4o"},
        { title:"Java", desc:"Clean OOP, Android/back-end systems, DSA, debugging.", icon:"https://upload.wikimedia.org/wikipedia/it/2/2e/Java_Logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67ef5e1c6e9c8191b70a38f779ffa6e6-java?model=gpt-4o"},
        { title:"React", desc:"Build fast component-based UIs with hooks & state.", icon:"https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg", categories:["Frontend","Frameworks"], url:"https://chatgpt.com/g/g-67ef5d4d75a48191aa49f525af48e4d9-react"},
        { title:"HTML&CSS", desc:"Responsive layouts, flexbox, grid, forms, animations — clean design help.", icon:"https://upload.wikimedia.org/wikipedia/commons/6/61/HTML5_logo_and_wordmark.svg", categories:["Frontend","Design"], url:"https://chatgpt.com/g/g-67ef5b2d70bc81918d9a5c2877de14d7-html-css?model=gpt-4o"},
        { title:"Python", desc:"Scripting, automation, data science, AI — clean code and real-world use cases.", icon:"https://upload.wikimedia.org/wikipedia/commons/c/c3/Python-logo-notext.svg", categories:["Languages","AI & Automation"], url:"https://chatgpt.com/g/g-67ef5a74409081919143341dc018e522-python?model=gpt-5"},
        { title:"JavaScript", desc:"Modern JS — ES6+, DOM, async, Node.js. Debugging & best practices.", icon:"https://upload.wikimedia.org/wikipedia/commons/9/99/Unofficial_JavaScript_logo_2.svg", categories:["Languages","Frontend"], url:"https://chatgpt.com/g/g-67ef55adf8bc8191b0ed342c54a7ffed-javascript"},
        { title:"c++ cpp", desc:"Write, debug, and learn modern C++ with STL. Basics to advanced & competitive programming.", icon:"https://upload.wikimedia.org/wikipedia/commons/1/18/ISO_C%2B%2B_Logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-67e5dd64ae48819198a2a7ec557a70ce-c-cpp"},
        { title:"Part-Time Canada 🇨🇦💼", desc:"Find part-time jobs in Canada. Resume help, interview prep, and job search guidance.", icon:"https://cdn-icons-png.flaticon.com/512/1041/1041926.png", categories:["Careers"], url:"https://chatgpt.com/g/g-67e0199bba8c8191b4b18babb5e4371b-part-time-canada?model=gpt-4o"},
        { title:"Part-Time USA 🇺🇸💼", desc:"Find part-time jobs in the USA. Resume help, interview prep, and job search guidance.", icon:"https://cdn-icons-png.flaticon.com/512/1041/1041926.png", categories:["Careers"], url:"https://chatgpt.com/g/g-67e013d13f94819184fcb52c29055801-part-time-usa?model=gpt-4o"},
        { title:"Task Master", desc:"Master your time, crush your goals. Zero overwhelm.", icon:"https://cdn-icons-png.flaticon.com/512/1005/1005141.png", categories:["Productivity"], url:"https://chatgpt.com/g/g-67dea8dbd7308191ad830a0bf253cad3-task-master-mind?model=gpt-4o"},
        { title:"PHP", desc:"A sharp PHP helper for modern backend work: PHP 8.3 syntax, Composer, Laravel/Symfony, WordPress hooks, secure PDO, DX tips, benchmarks, and bug-fixing.", icon:"https://www.php.net/images/logos/new-php-logo.svg", categories:["Languages"], url:"https://chatgpt.com/g/g-68cbbcf3baac81918fd5ec4667a31a0e-php-pro-studio?model=gpt-5"},
        { title:"CS Roast Battle GPT", desc:"Roasts entire programming languages.", icon:"https://cdn-icons-png.flaticon.com/512/3069/3069151.png", categories:["Humor","Languages"], url:"https://chatgpt.com/g/g-68dac3d327d88191a9eaa7acf549e9f3-cs-roast-battle-gpt?model=gpt-5"},
        { title:"Startup Pitch GPT", desc:"Turns random code into billion-dollar startup pitches.", icon:"https://cdn-icons-png.flaticon.com/512/3135/3135728.png", categories:["Humor","Careers"], url:"https://chatgpt.com/g/g-68dac274b17c819184887dd80271c125-startup-pitch-gpt?model=gpt-5"},
        { title:"Haunted Compiler GPT", desc:"Acts like your compiler is possessed.", icon:"https://cdn-icons-png.flaticon.com/512/2873/2873646.png", categories:["Humor"], url:"https://chatgpt.com/g/g-68dac0df1cf88191aaff7952ea764a39-haunted-compiler-gpt?model=gpt-5"},
        { title:"Code Horror Stories GPT", desc:"Tells creepy campfire stories about bugs.", icon:"https://cdn-icons-png.flaticon.com/512/1792/1792942.png", categories:["Humor"], url:"https://chatgpt.com/g/g-68dac00c2b3481918393a8d577d44408-code-horror-stories-gpt"},
        { title:"StackOverflow Parrot GPT", desc:"The sassiest dev bot alive. Ask it anything and get roasted like you're on StackOverflow...", icon:"https://cdn-icons-png.flaticon.com/512/2926/2926725.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dabe58efc88191b7b5340395c98de7-stackoverflow-parrot-gpt?model=gpt-5"},
        { title:"Meme Compiler GPT", desc:"Compiles errors into memes.", icon:"https://cdn-icons-png.flaticon.com/512/3221/3221596.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dabd397b3c8191a464c3e7e6aa6cab-meme-compiler-gpt?model=gpt-5"},
        { title:"Code Reviewer From Hell GPT", desc:"Roasts your code brutally but hilariously.", icon:"https://cdn-icons-png.flaticon.com/512/2613/2613106.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dabbb898a8819182b05c6c3bb15150-code-reviewer-from-hell-gpt?model=gpt-5"},
        { title:"Debug Dungeon GPT", desc:"Debugging turned into a text-based RPG.", icon:"https://cdn-icons-png.flaticon.com/512/2953/2953531.png", categories:["Tools","Learning"], url:"https://chatgpt.com/g/g-68daba494c44819190c3757fc4236360-debug-dungeon-gpt?model=gpt-5"},
        { title:"Code-to-Rap GPT", desc:"Explains code by rapping about it.", icon:"https://cdn-icons-png.flaticon.com/512/2769/2769747.png", categories:["Humor","Learning"], url:"https://chatgpt.com/g/g-68dab7f617cc819198b1432fe32cf307-code-to-rap-gpt?model=gpt-5"},
        { title:"Bug Meme GPT", desc:"Turns bugs into instant memes.", icon:"https://cdn-icons-png.flaticon.com/512/3221/3221614.png", categories:["Humor","Tools"], url:"https://chatgpt.com/g/g-68dab3b8cebc819180d1b629ab574579-bug-meme-gpt?model=gpt-5"}
      ];

      const formattedGpts = allGpts.map(item => ({
        id: uuidv4(),
        createdAt: Date.now() - Math.floor(Math.random() * 1000000),
        status: 'hidden',
        featured: false,
        title: item.title || item.name,
        desc: item.desc || `A helpful assistant for ${item.name || item.title}.`,
        icon: item.icon,
        categories: item.categories || ["Languages"],
        tags: item.tags || [],
        url: item.url,
      }));

      const defaultData = { settings: { title: "GPTMart" }, items: formattedGpts };
      await writeDB(defaultData);
      return defaultData;
    }
  }

  // --- ATOMIC WRITES W/ QUEUE ---
  let isWriting = false;
  const writeQueue = [];

  async function writeDB(data) {
    if (isWriting) {
      writeQueue.push(data);
      return;
    }
    isWriting = true;
    try {
      const tmpPath = DB_PATH + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2));
      await fs.rename(tmpPath, DB_PATH); // atomic replace
    } finally {
      isWriting = false;
      if (writeQueue.length > 0) {
        const nextData = writeQueue.shift();
        writeDB(nextData);
      }
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
  function getCookieToken(req) {
    const raw = req.headers.cookie || '';
    const jar = Object.fromEntries(
      raw.split(';').map(v => v.trim()).filter(Boolean).map(kv => {
        const i = kv.indexOf('=');
        return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))];
      })
    );
    return jar.session || null;
  }

  // constant-time PIN compare
  function checkPin(supplied) {
    const a = Buffer.from(ADMIN_PIN);
    const b = Buffer.from(String(supplied || '').trim());
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // parse body helper (JSON or form)
  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => (body += chunk.toString()));
      req.on('end', () => {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        try {
          if (ct.includes('application/json')) {
            resolve(JSON.parse(body || '{}'));
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            resolve(querystring.parse(body));
          } else {
            // Try JSON then fallback to plain
            try {
              resolve(JSON.parse(body || '{}'));
            } catch {
              resolve({ raw: body });
            }
          }
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  // CORS helper
  function setCORS(req, res) {
    const origin = req.headers.origin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // --- SERVER ---
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;

    // CORS + preflight
    setCORS(req, res);
    if (method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');

      // LOGIN (accept JSON or form)
      if (url.pathname === '/api/login' && method === 'POST') {
        try {
          const body = await parseBody(req);
          const pin = body.pin ?? body.PIN ?? body.passcode ?? body.password ?? '';
          if (checkPin(pin)) {
            const token = createToken({ user: 'admin' });

            // set httpOnly cookie for browsers
            const isSecure = (req.headers['x-forwarded-proto'] || '').includes('https');
            const cookie = [
              `session=${encodeURIComponent(token)}`,
              'HttpOnly',
              'Path=/',
              'SameSite=Lax',
              isSecure ? 'Secure' : null,
              'Max-Age=3600'
            ].filter(Boolean).join('; ');
            res.setHeader('Set-Cookie', cookie);

            res.writeHead(200).end(JSON.stringify({ success: true, token }));
          } else {
            res.writeHead(401).end(JSON.stringify({ error: 'Invalid PIN' }));
          }
        } catch (e) {
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

      // AUTH (Bearer or Cookie)
      const authHeader = req.headers['authorization'];
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const cookieTok = getCookieToken(req);
      const user = verifyTokenValue(bearer || cookieTok);
      if (!user) {
        res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // Mutating / admin routes
      const db = await readDB();

      if (url.pathname === '/api/gpts/all' && method === 'GET') {
        res.writeHead(200).end(JSON.stringify(db));
        return;
      }

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
        } catch (e) {
          res.writeHead(500).end(JSON.stringify({ error: 'Server error' }));
        }
      });
      return;
    }

    // Static files
    try {
      let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
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
    } catch (err) {
      res.writeHead(404).end('<h1>404 Not Found</h1>');
    }
  });

  server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}/`);
  });
}

startServer().catch(err => console.error('Failed to start server:', err));
