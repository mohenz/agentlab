// 오늘의 초청 일정 — PMOTOOLS(NextAuth 로그인 + GET /api/v1/messages)에서 받은 초청 중 오늘 시작하는 것만 모은다.
// 설정(config.json)의 schedule 에 계정을 적어 두면 서버가 주기적으로 로그인해 가져온다.
//   "schedule": { "baseUrl": "http://pmotools.example:3020", "userId": "...", "password": "...", "projectCode": "PRJ01",
//                 "refreshMinutes": 15, "greeter": "Rachael", "timeZone": "Asia/Seoul" }
// ※ 비밀번호는 config.json 에 평문으로 남는다(사용자가 이 방식을 선택). 그래서 이 모듈은
//   - 비밀번호를 응답(/api/office·/api/config)·로그·오류 문구에 절대 싣지 않고,
//   - 설정이 불완전하면 조용히 꺼진다(null)
//   - 오류는 짧은 코드(login·network·http·parse)로만 내보낸다.
const PERIOD = { min: 5, max: 120, def: 15 };
const TIMEOUT_MS = 10000;
const MAX_ITEMS = 30;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 설정 → 검증된 schedule 설정 또는 null(꺼짐). baseUrl 은 http(s) 만, 계정·프로젝트 코드는 필수 */
export function normalizeSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let baseUrl;
  try {
    const u = new URL(String(raw.baseUrl || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    baseUrl = u.origin;
  } catch {
    return null;
  }
  const userId = text(raw.userId, 80);
  const password = typeof raw.password === 'string' ? raw.password.slice(0, 200) : '';
  const projectCode = text(raw.projectCode, 40);
  if (!userId || !password || !projectCode) return null;
  const n = Number(raw.refreshMinutes);
  return {
    baseUrl, userId, password, projectCode,
    refreshMinutes: Number.isFinite(n) ? Math.min(PERIOD.max, Math.max(PERIOD.min, Math.round(n))) : PERIOD.def,
    greeter: text(raw.greeter, 40) || 'Rachael',
    timeZone: validZone(raw.timeZone) || 'Asia/Seoul',
  };
}

function validZone(z) {
  if (typeof z !== 'string' || !z) return '';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: z });
    return z;
  } catch {
    return '';
  }
}

/** ISO 시각 → 그 시간대의 날짜(YYYY-MM-DD) */
export function dayKey(ms, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** 초청 목록(API rows) → 오늘 시작하는 일정(시작 순). 일정 초청(calendarInvitation)과 회의실 초청(meetingInvitation)을 같은 모양으로 */
export function todayItems(rows, now = Date.now(), timeZone = 'Asia/Seoul') {
  const today = dayKey(now, timeZone);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    const c = r.calendarInvitation, m = r.meetingInvitation;
    const src = c && typeof c === 'object' ? { title: c.title, startAt: c.startAt, endAt: c.endAt, allDay: !!c.allDay, location: c.location, kind: 'calendar' }
      : m && typeof m === 'object' ? { title: m.purpose, startAt: m.startAt, endAt: m.endAt, allDay: false, location: m.roomName, kind: 'meeting' } : null;
    if (!src) continue;
    const start = Date.parse(String(src.startAt || ''));
    if (!Number.isFinite(start) || dayKey(start, timeZone) !== today) continue;
    const end = Date.parse(String(src.endAt || ''));
    out.push({
      id: text(r.id, 64), title: text(src.title, 120) || '(제목 없음)', startAt: new Date(start).toISOString(),
      endAt: Number.isFinite(end) ? new Date(end).toISOString() : null, allDay: src.allDay, location: text(src.location, 80),
      sender: text(r.senderName, 40), kind: src.kind, isRead: r.isRead !== false,
    });
  }
  out.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  return out.slice(0, MAX_ITEMS);
}

class ScheduleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(res, jar) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of list) {
    const first = String(line).split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1));
  }
}
const withTimeout = (init = {}) => ({ ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });

/** PMOTOOLS 에 로그인해 받은 초청 목록(rows) 을 돌려준다. 실패하면 ScheduleError(login|network|http|parse) */
export async function fetchInvitations(cfg, fetchImpl = fetch) {
  const jar = new Map();
  try {
    const csrfRes = await fetchImpl(`${cfg.baseUrl}/api/auth/csrf`, withTimeout());
    absorb(csrfRes, jar);
    const csrf = (await csrfRes.json()).csrfToken;
    if (!csrf) throw new ScheduleError('login');
    const body = new URLSearchParams({ userId: cfg.userId, password: cfg.password, projectCode: cfg.projectCode, csrfToken: csrf, json: 'true' });
    const login = await fetchImpl(`${cfg.baseUrl}/api/auth/callback/credentials`, withTimeout({
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) }, body,
    }));
    absorb(login, jar);
    const loc = login.headers.get('location') || '';
    if ([...jar.keys()].every((k) => !/session-token/.test(k)) || /error=/.test(loc)) throw new ScheduleError('login');
    const res = await fetchImpl(`${cfg.baseUrl}/api/v1/messages`, withTimeout({ headers: { cookie: cookieHeader(jar) } }));
    if (res.status === 401 || res.status === 403) throw new ScheduleError('login');
    if (!res.ok) throw new ScheduleError('http');
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ScheduleError('parse');
    }
    if (!json || !Array.isArray(json.data)) throw new ScheduleError('parse');
    return json.data;
  } catch (e) {
    if (e instanceof ScheduleError) throw e;
    throw new ScheduleError('network'); // 시간 초과·연결 실패 — 원인 문구(주소·계정이 섞일 수 있음)는 버린다
  }
}

// ---------- 캐시와 갱신 — 스냅샷(3초 폴링)은 캐시만 읽고, 오래되면 뒤에서 한 번만 새로 받는다 ----------
let state = { rows: [], fetchedAt: null, error: null, at: 0, running: false };

export function forget() {
  state = { rows: [], fetchedAt: null, error: null, at: 0, running: false };
}

/** 지금 보여 줄 값. cfg 가 null 이면 null(기능 꺼짐) */
export function scheduleView(cfg, now = Date.now()) {
  if (!cfg) return null;
  const items = todayItems(state.rows || [], now, cfg.timeZone); // 날짜가 바뀌면 같은 목록에서 다시 거른다
  return { items, fetchedAt: state.fetchedAt, error: state.error, greeter: cfg.greeter };
}

/** 주기가 지났으면 뒤에서 새로 받는다(기다리지 않는다). 시험에서는 fetchImpl 을 넣는다 */
export function refreshSchedule(cfg, now = Date.now(), fetchImpl = fetch) {
  if (!cfg || state.running) return null;
  if (state.at && now - state.at < cfg.refreshMinutes * 60000) return null;
  state.running = true;
  state.at = now;
  return fetchInvitations(cfg, fetchImpl)
    .then((rows) => { state.rows = rows; state.fetchedAt = new Date(now).toISOString(); state.error = null; })
    .catch((e) => { state.error = e && e.code ? e.code : 'network'; state.at = now - (cfg.refreshMinutes - 1) * 60000; }) // 실패하면 1분 뒤 다시
    .finally(() => { state.running = false; });
}
