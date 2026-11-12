#!/usr/bin/env node
// 로컬 HTTP 서버 — 기본은 127.0.0.1 에만 붙는 보기 전용 화면. config.json 의 lan 을 켜면 사내망에 열리고, 다른 PC 는 6자리 암호 로그인이 필요하다.
// 사용법: node server/server.mjs [--port N] [--demo] [--open]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_DIR, officeHome, pidFile, startingLock } from './paths.mjs';
import { VERSION, demoPort, loadConfig, resolvePort } from './config.mjs';
import { createGate, isLoopback, loginPage, normalizeLan } from './lan.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { createDemo } from './demo.mjs';
import { APP, health, openBrowser, removePidFile, urlOf } from './control.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.map': 'application/json',
};
const SNAPSHOT_MEMO_MS = 1000; // 탭 여러 개가 동시에 물어도 1초에 한 번만 조립
const MAX_STATIC = 5000;

/** 시작 때 web/ 를 훑어 내줄 파일 목록을 만든다. '_'·'.' 로 시작하는 이름과 링크는 뺀다 */
export function scanWeb(webDir = WEB_DIR) {
  const files = new Map(); // '/office/frog.webp' → 절대경로
  const walk = (dir, prefix) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (files.size >= MAX_STATIC) return;
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, `${prefix}${e.name}/`);
      else if (e.isFile() && TYPES[path.extname(e.name).toLowerCase()]) files.set(`${prefix}${e.name}`, abs);
    }
  };
  walk(webDir, '/');
  return files;
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

function sendFile(req, res, abs) {
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return send(res, 404, 'not found');
  }
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  const headers = { ...BASE_HEADERS, 'Content-Type': TYPES[path.extname(abs).toLowerCase()], 'Cache-Control': 'no-cache', ETag: etag };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  const stream = fs.createReadStream(abs);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** 요청 본문을 작게 읽는다(로그인 양식용). 한도를 넘으면 null */
function readBody(req, max = 512) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/** http.Server 를 만든다(listen 은 호출자가). opts: webDir·demo·snapshot(시험용 주입)·lan({pin} — 있으면 다른 PC 요청을 로그인으로 받는다) */
export function createOfficeServer({ webDir = WEB_DIR, demo = false, snapshot, lan = null } = {}) {
  const gate = lan && lan.pin ? createGate({ pin: lan.pin }) : null;
  const files = scanWeb(webDir);
  const demoSnap = demo ? createDemo() : null;
  const make = snapshot || (demo ? async () => demoSnap(Date.now()) : () => buildSnapshot());
  let memo = { at: 0, promise: null };
  const getSnapshot = () => {
    const now = Date.now();
    if (!memo.promise || now - memo.at >= SNAPSHOT_MEMO_MS) memo = { at: now, promise: Promise.resolve().then(make) };
    return memo.promise;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const remote = !!gate && !isLoopback(req.socket.remoteAddress);
      const raw = String(req.url || '/');
      const q = raw.indexOf('?');
      const p = q >= 0 ? raw.slice(0, q) : raw;
      if (remote) {
        // 다른 PC — 로그인 창과 로그인 처리만 열어 두고, 나머지는 로그인한 사람에게만 보여 준다(읽기 전용)
        const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (p === '/login') {
          if (req.method === 'POST') {
            const body = await readBody(req);
            const pin = body === null ? '' : String(new URLSearchParams(body).get('pin') || '');
            const r = gate.login(ip, pin);
            console.log(`${new Date().toISOString()} login ${r.ok ? 'ok' : r.locked ? 'locked' : 'fail'} ${ip}`);
            if (r.ok) return send(res, 303, '', undefined, { Location: '/', 'Set-Cookie': gate.cookie(r.token) });
            const msg = r.locked ? `시도가 너무 많습니다. ${Math.max(1, Math.ceil(r.retryAfter / 60))}분 뒤에 다시 시도하십시오.` : '암호가 맞지 않습니다.';
            return send(res, r.locked ? 429 : 401, loginPage(msg), 'text/html; charset=utf-8', r.locked ? { 'Retry-After': String(r.retryAfter) } : {});
          }
          if (req.method !== 'GET') return send(res, 405, 'method not allowed', undefined, { Allow: 'GET, POST' });
          if (gate.authed(req)) return send(res, 303, '', undefined, { Location: '/' });
          return send(res, 200, loginPage(), 'text/html; charset=utf-8');
        }
        if (!gate.authed(req)) {
          const wantsPage = req.method === 'GET' && !p.startsWith('/api/') && String(req.headers.accept || '').includes('text/html');
          if (wantsPage) return send(res, 303, '', undefined, { Location: '/login' });
          return sendJson(res, 401, { error: 'login required' });
        }
        if (req.method !== 'GET') return send(res, 405, 'method not allowed', undefined, { Allow: 'GET' });
      } else {
        // DNS 리바인딩 방지 — 남의 도메인 이름으로 들어온 요청은 거절한다
        const port = server.address() && server.address().port;
        const host = String(req.headers.host || '').toLowerCase();
        if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) return send(res, 403, 'forbidden');
        if (req.method !== 'GET') return send(res, 405, 'method not allowed', undefined, { Allow: 'GET' });
      }
      if (/\.\.|%2e|\\|%5c|%00/i.test(p)) return send(res, 404, 'not found'); // 경로조작
      let route;
      try {
        route = decodeURIComponent(p);
      } catch {
        return send(res, 404, 'not found');
      }
      if (route === '/api/office') {
        try {
          return sendJson(res, 200, await getSnapshot());
        } catch (e) {
          console.error(new Date().toISOString(), 'snapshot failed:', e && e.stack ? e.stack : e);
          return sendJson(res, 500, { error: 'snapshot failed' });
        }
      }
      if (route === '/api/config') return sendJson(res, 200, { lang: loadConfig().lang, version: VERSION });
      if (route === '/api/health') return sendJson(res, 200, { ok: true, app: APP, version: VERSION, demo, pid: process.pid });
      const abs = files.get(route === '/' ? '/index.html' : route);
      if (!abs) return send(res, 404, 'not found');
      return sendFile(req, res, abs);
    } catch (e) {
      console.error(new Date().toISOString(), 'request failed:', e && e.stack ? e.stack : e);
      if (!res.headersSent) send(res, 500, 'error');
      else res.destroy();
    }
  });
  return server;
}

function parseArgs(argv) {
  const opts = { port: null, demo: false, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') opts.demo = true;
    else if (a === '--open') opts.open = true;
    else if (a === '--port' || a.startsWith('--port=')) {
      const v = Number(a.includes('=') ? a.split('=')[1] : argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error(`잘못된 포트 / bad port: ${a}`);
      opts.port = v;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const port = opts.port || (opts.demo ? demoPort() : resolvePort());
  const url = urlOf(port);
  const lan = opts.demo ? { enabled: false, pin: '' } : normalizeLan(loadConfig().lan);   // 데모는 늘 이 PC 전용
  const server = createOfficeServer({ demo: opts.demo, lan: lan.enabled ? lan : null });
  server.on('error', async (e) => {
    if (e.code !== 'EADDRINUSE') {
      console.error(`서버를 못 띄웠습니다 / cannot start server: ${e.message}`);
      process.exit(1);
    }
    const h = await health(port);
    if (h) {
      console.log(`이미 떠 있습니다 / already running: ${url}${h.demo ? ' (demo)' : ''}`);
      if (opts.open) openBrowser(url);
      process.exit(0);
    }
    console.error(`포트 ${port} 를 다른 프로그램이 쓰고 있습니다 / port ${port} is used by another program. ` +
      `config.json 의 port 나 CLAUDE_OFFICE_PORT 로 바꾸세요 / change "port" in config.json or set CLAUDE_OFFICE_PORT.`);
    process.exit(1);
  });
  server.listen(port, lan.enabled ? '0.0.0.0' : '127.0.0.1', () => {
    try {
      fs.mkdirSync(officeHome(), { recursive: true });
      fs.writeFileSync(pidFile(opts.demo), JSON.stringify({ pid: process.pid, port, demo: opts.demo, startedAt: new Date().toISOString() }));
      if (!opts.demo) fs.rmSync(startingLock(), { force: true });
    } catch (e) {
      console.error('pid 파일을 못 썼습니다 / cannot write pid file:', e.message);
    }
    console.log(`${new Date().toISOString()} AgentLab ${VERSION} ${opts.demo ? 'demo ' : ''}listening on ${url}${lan.enabled ? ' (사내망 공개 — 다른 PC 는 암호 로그인)' : ''}`);
    if (opts.open) openBrowser(url);
  });
  const bye = () => {
    server.close();
    process.exit(0);
  };
  process.on('exit', () => removePidFile(opts.demo, process.pid));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try {
      process.on(sig, bye);
    } catch {
      /* 윈도우에 없는 신호 */
    }
  }
}

/** 직접 실행됐나 — 링크 경로로 불려도 맞게 실제 경로끼리 견준다 */
function isMain() {
  try {
    const a = fs.realpathSync(fileURLToPath(import.meta.url));
    const b = fs.realpathSync(path.resolve(process.argv[1] || ''));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
