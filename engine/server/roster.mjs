// 상주 에이전트(roster) — Claude 세션이 없어도 사무실에 앉아 있는 에이전트.
// config.json 의 roster 에 적어 둔 에이전트를 사무실 사람으로 올린다.
//   - match 가 살아 있는 사람(프로젝트 폴더 이름 또는 경로)과 맞으면 그 사람의 이름·역할을 바꾼다(새 캐릭터를 만들지 않는다).
//   - 맞는 사람이 없으면 책상에 앉은(쉬는 중) 캐릭터를 하나 더 올린다. process 가 있으면 그 프로세스가 떠 있는지로 켜짐/꺼짐을 표시한다.
import { execFileSync } from 'node:child_process';
import { IS_WIN, pathKey } from './paths.mjs';

export const MAX_ROSTER = 30;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** 성별 → 'f'(여)·'m'(남)·''(안 적음). f/female/여/여자 · m/male/남/남자 를 받는다 */
export function normalizeGender(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (['f', 'female', '여', '여자', '여성'].includes(s)) return 'f';
  if (['m', 'male', '남', '남자', '남성'].includes(s)) return 'm';
  return '';
}

/** 설정의 roster 를 검증한다. 이름이 없거나 같은 이름이 또 나오면 버린다. */
export function normalizeRoster(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const name = text(e.name, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, role: text(e.role, 80), tool: text(e.tool, 60), match: text(e.match, 260), process: text(e.process, 80), floor: text(e.floor, 20), account: text(e.account, 12), gender: normalizeGender(e.gender) });
    if (out.length >= MAX_ROSTER) break;
  }
  return out;
}

const imageKey = (s) => String(s).trim().toLowerCase();
let procCache = { at: 0, set: new Set() };

/** 지금 떠 있는 프로세스 이미지 이름 집합(소문자). 5초 캐시. 못 읽으면 빈 집합 */
export function runningImages(now = Date.now()) {
  if (now - procCache.at < 5000) return procCache.set;
  const set = new Set();
  try {
    if (IS_WIN) {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 4000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
      for (const line of out.split(/\r?\n/)) {
        const m = /^"([^"]+)"/.exec(line);
        if (m) set.add(imageKey(m[1]));
      }
    } else {
      const out = execFileSync('ps', ['-eo', 'comm='], { encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024 });
      for (const line of out.split('\n')) if (line.trim()) set.add(imageKey(line.trim().split('/').pop()));
    }
  } catch {
    /* 못 읽으면 꺼짐으로 본다 */
  }
  procCache = { at: now, set };
  return set;
}

export function forget() {
  procCache = { at: 0, set: new Set() };
}

/**
 * 살아 있는 사람 목록에 상주 에이전트를 얹는다(목록을 직접 고친다).
 * opts.running — 떠 있는 프로세스 이름 집합(시험용 주입), opts.hide — 숨길 이름·경로 판정 함수
 */
export function applyRoster(people, roster, opts = {}) {
  if (!Array.isArray(roster) || !roster.length) return people;
  const running = opts.running ?? runningImages();
  const hidden = opts.hide ?? (() => false);
  const taken = new Set(); // 이미 이름을 얻은 살아 있는 사람(한 사람이 둘로 불리지 않게)
  for (const entry of roster) {
    if (hidden(entry.name)) continue;
    const online = entry.process ? running.has(imageKey(entry.process)) : true;
    const meta = { role: entry.role, tool: entry.tool, roster: true, online, ...(entry.floor ? { floor: entry.floor } : {}), ...(entry.account ? { account: entry.account } : {}), ...(entry.gender ? { gender: entry.gender } : {}) };
    const live = entry.match
      ? people.find((p) => !taken.has(p) && (String(p.name).toLowerCase() === entry.match.toLowerCase() || pathKey(p.path) === pathKey(entry.match)))
      : null;
    if (live) {
      taken.add(live);
      Object.assign(live, meta, { project: live.name, name: entry.name }); // 원래 프로젝트 이름은 project 로 남긴다
      continue;
    }
    people.push({
      id: `roster:${entry.name}`, name: entry.name, path: '', status: 'rest', pending: 0, ask: '', sessions: 0,
      source: 'roster', commits: null, kid: false, home: null, compactions: 0, context: null, account: null, gender: null, subs: [], subCount: 0, doing: null, log: [], ...meta,
    });
  }
  return people;
}
