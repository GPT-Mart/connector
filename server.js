const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

async function startServer(){
  const { v4: uuidv4 } = await import('uuid');
  const PORT = process.env.PORT || 3000;
  const ADMIN_PIN = (process.env.ADMIN_PIN || '4545').trim();
  const DATA_DIR = process.env.DATA_DIR || __dirname;
  const DB_PATH = path.join(DATA_DIR,'db.json');
  const LEADS_PATH = path.join(DATA_DIR,'leads.json');

  async function readJSON(file, fallback){
    try{const data=await fs.readFile(file,'utf8');return JSON.parse(data);}
    catch{await fs.writeFile(file,JSON.stringify(fallback,null,2));return fallback;}
  }
  async function writeJSON(file,data){
    const tmp=file+'.tmp';
    await fs.writeFile(tmp,JSON.stringify(data,null,2));
    await fs.rename(tmp,file);
  }

  const sessions={};
  function createToken(data){const t=uuidv4();sessions[t]={user:data,expires:Date.now()+3600e3};return t;}
  function verifyTokenValue(token){const s=token&&sessions[token];if(s&&s.expires>Date.now())return s.user;if(s)delete sessions[token];return null;}
  function checkPin(s){const a=Buffer.from(ADMIN_PIN),b=Buffer.from(String(s||'').trim());if(a.length!==b.length)return false;return crypto.timingSafeEqual(a,b);}

  function parseBody(req){
    return new Promise((resolve,reject)=>{
      let body='';req.on('data',chunk=>body+=chunk);
      req.on('end',()=>{try{
        const ct=(req.headers['content-type']||'').toLowerCase();
        resolve(ct.includes('json')?JSON.parse(body||'{}'):querystring.parse(body));
      }catch(e){reject(e);}});
    });
  }
  function setCORS(req,res){
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin||'*');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials','true');
  }

  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host}`);
    const method=req.method;
    setCORS(req,res);
    if(method==='OPTIONS'){res.writeHead(204).end();return;}

    if(url.pathname==='/api/leads' && method==='POST'){
      const body=await parseBody(req);
      const leads=await readJSON(LEADS_PATH,[]);
      leads.push({id:uuidv4(),email:body.email,name:body.name||'',message:body.message,ua:body.ua||'',tz:body.tz||'',createdAt:Date.now()});
      await writeJSON(LEADS_PATH,leads);
      res.writeHead(201,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));
      return;
    }

    if(url.pathname==='/api/leads' && method==='GET'){
      const auth=(req.headers.authorization||'').replace('Bearer ','');
      const user=verifyTokenValue(auth);
      if(!user){res.writeHead(401).end(JSON.stringify({error:'Unauthorized'}));return;}
      const leads=await readJSON(LEADS_PATH,[]);
      res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({items:leads}));
      return;
    }

    if(url.pathname==='/api/login' && method==='POST'){
      const body=await parseBody(req);
      if(checkPin(body.pin)){const t=createToken({user:'admin'});res.writeHead(200).end(JSON.stringify({token:t}));}
      else res.writeHead(401).end(JSON.stringify({error:'Invalid PIN'}));
      return;
    }

    try{
      const filePath=path.join(__dirname,url.pathname==='/'?'index.html':url.pathname);
      const data=await fs.readFile(filePath);
      let ct='text/html';if(filePath.endsWith('.js'))ct='application/javascript';
      else if(filePath.endsWith('.css'))ct='text/css';else if(filePath.endsWith('.json'))ct='application/json';
      res.writeHead(200,{'Content-Type':ct}).end(data);
    }catch{res.writeHead(404).end('Not Found');}
  });

  server.listen(PORT,()=>console.log(`✅ Server running at http://localhost:${PORT}`));
}
startServer();
