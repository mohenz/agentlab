// 사내망 공개 — 다른 PC 접속을 6자리 숫자 암호 로그인으로만 연다.
// 이 PC(루프백)에서 오는 요청은 그대로(훅·상태 점검 포함), 다른 PC 요청은 로그인 쿠키가 있어야 한다.
// 6자리는 100만 가지뿐이라 무차별 대입을 막는 잠금이 이 파일의 핵심이다(IP별 잠금 + 전체 잠금).
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'agentlab_sid';
const SESSION_MS = 12 * 3600 * 1000;
const MAX_SESSIONS = 200;
const IP_FAILS = 5, IP_LOCK_MS = 15 * 60 * 1000;           // 한 주소가 5번 틀리면 15분
const ALL_FAILS = 20, ALL_WINDOW_MS = 10 * 60 * 1000, ALL_LOCK_MS = 10 * 60 * 1000; // 어디서든 10분에 20번 틀리면 10분

/** config.lan → { enabled, pin }. 6자리 숫자 암호가 없으면 열지 않는다(켜 놓고 암호가 비면 닫힌 채로) */
export function normalizeLan(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const pin = typeof r.pin === 'string' ? r.pin.trim() : typeof r.pin === 'number' ? String(r.pin).padStart(6, '0') : '';
  const ok = /^\d{6}$/.test(pin);
  return { enabled: r.enabled === true && ok, pin: ok ? pin : '' };
}

export function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const cookieOf = (req) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim();
  }
  return '';
};

/** 로그인 문지기 — 세션·실패 횟수는 메모리에만 둔다(서버를 다시 켜면 모두 다시 로그인) */
export function createGate({ pin, now = () => Date.now() }) {
  const pinHash = sha(pin);
  const sessions = new Map();               // 토큰 → 만료 시각
  const fails = new Map();                  // ip → { n, until }
  let recent = [];                          // 최근 실패 시각들(전체)
  let allUntil = 0;

  const prune = () => {
    const t = now();
    for (const [k, v] of sessions) if (v <= t) sessions.delete(k);
    for (const [k, v] of fails) if (v.until && v.until <= t) fails.delete(k);
    recent = recent.filter((x) => t - x < ALL_WINDOW_MS);
  };

  return {
    authed(req) {
      prune();
      const tok = cookieOf(req);
      return !!tok && sessions.has(tok);
    },
    /** 로그인 시도 → { ok, token } | { ok:false, locked, retryAfter(초) } */
    login(ip, input) {
      prune();
      const t = now();
      if (allUntil > t) return { ok: false, locked: true, retryAfter: Math.ceil((allUntil - t) / 1000) };
      const f = fails.get(ip);
      if (f && f.until > t) return { ok: false, locked: true, retryAfter: Math.ceil((f.until - t) / 1000) };
      // 길이가 달라도 같은 시간이 걸리게 해시끼리 견준다
      if (crypto.timingSafeEqual(sha(input), pinHash)) {
        fails.delete(ip);
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, t + SESSION_MS);
        return { ok: true, token };
      }
      const n = (f ? f.n : 0) + 1;
      fails.set(ip, n >= IP_FAILS ? { n: 0, until: t + IP_LOCK_MS } : { n, until: 0 });
      recent.push(t);
      if (recent.length >= ALL_FAILS) { allUntil = t + ALL_LOCK_MS; recent = []; }
      const locked = n >= IP_FAILS;
      return { ok: false, locked, retryAfter: locked ? Math.ceil(IP_LOCK_MS / 1000) : 0 };
    },
    cookie(token) {
      return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
    },
    logout(req) {
      sessions.delete(cookieOf(req));
    },
  };
}

/** 로그인 창 — 글자·스타일 모두 이 안에 넣어(외부 파일·스크립트 없음) 로그인 전에도 낼 수 있다 */
export function loginPage(error = '') {
  const msg = error ? `<p class="err" role="alert">${error}</p>` : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>AgentLab</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;background:#EDEFF1;color:#1E2622;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif}
form{width:min(340px,calc(100% - 32px));padding:28px 24px;background:#fff;border:1px solid rgba(20,30,25,.12);border-radius:14px;box-shadow:0 8px 28px rgba(20,30,25,.08)}
h1{margin:0 0 18px;font-size:22px;font-weight:800;letter-spacing:-.01em}
label{display:block;margin:0 0 6px;font-size:13px;font-weight:700;color:#33403A}
input{width:100%;height:48px;padding:0 14px;font:700 24px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.5em;text-align:center;border:1px solid rgba(20,30,25,.25);border-radius:10px}
input:focus{outline:2px solid #E8892B;outline-offset:1px}
button{width:100%;height:46px;margin-top:14px;border:0;border-radius:10px;background:#1E2622;color:#fff;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer}
.err{margin:12px 0 0;padding:8px 10px;border-radius:8px;background:#FDE7EA;color:#B4192F;font-weight:600}
</style></head><body>
<form method="post" action="/login" autocomplete="off">
<h1>AgentLab</h1>
<label for="pin">접속 암호 6자리</label>
<input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="one-time-code" autofocus required>
<button type="submit">접속</button>
${msg}
</form></body></html>`;
}
