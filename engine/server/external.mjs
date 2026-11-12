// 외부 에이전트(Codex·OpenCode 등 Claude Code 가 아닌 도구) — 사람이 아니라 도구가 카드를 써 주면 사무실에 올라온다.
// 입력 두 가지:
//   1) ~/.claude-office/external/<id>.json  — 어떤 도구든 이 카드만 쓰면 된다(hooks/external-notify.mjs 가 대신 써 준다).
//        { "id": "codex-1", "name": "my-app", "tool": "Codex", "cwd": "D:/work/my-app", "status": "working|decision|rest",
//          "message": "승인 대기 문구", "updatedAt": "ISO" }
//   2) Codex 세션 파일(~/.codex/sessions/**/rollout-*.jsonl) — 최근에 바뀐 파일이 있으면 그 폴더의 Codex 가 일하는 중으로 본다.
//        ※ 파일 형식을 파싱하지 않고 수정 시각과 첫 줄의 cwd 만 본다. 이 PC 에는 Codex 기록이 없어 실제 파일로는 확인하지 못했다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { officeHome } from './paths.mjs';

export const externalDir = () => path.join(officeHome(), 'external');
export const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
export const EXTERNAL_STALE_MS = 30 * 60 * 1000; // 이만큼 소식이 없으면 사무실에서 빠진다(끄고 잊은 카드)
export const CODEX_WORKING_MS = 2 * 60 * 1000; // 세션 파일이 이 안에 바뀌었으면 일하는 중
const STATUSES = new Set(['working', 'decision', 'rest']);
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** 카드 한 장 검증 → 정규화된 카드 또는 null(쓸 수 없음). id·cwd 는 필수, 모르는 status 는 rest */
export function normalizeExternal(raw, fallbackId = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id, 64) || fallbackId;
  const cwd = text(raw.cwd, 500);
  if (!ID_RE.test(id) || !cwd) return null;
  const ms = Date.parse(String(raw.updatedAt || ''));
  return {
    id,
    name: text(raw.name, 40),
    tool: text(raw.tool, 40),
    cwd,
    status: STATUSES.has(raw.status) ? raw.status : 'rest',
    message: text(raw.message, 200),
    at: Number.isFinite(ms) ? ms : 0,
  };
}

/** external/*.json → 살아 있는(30분 안) 카드 목록 */
export function readExternal(now = Date.now(), dir = externalDir()) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const f = path.join(dir, n);
    let card;
    try {
      card = normalizeExternal(JSON.parse(fs.readFileSync(f, 'utf8')), n.slice(0, -5));
      if (card && !card.at) card.at = fs.statSync(f).mtimeMs; // 날짜를 안 적었으면 파일 수정 시각
    } catch {
      card = null;
    }
    if (card && now - card.at <= EXTERNAL_STALE_MS) out.push(card);
  }
  return out;
}

/** 첫 줄에서 작업 폴더 — Codex 세션 파일의 첫 줄은 session_meta 이고 payload.cwd 에 있다고 알려져 있다(확인 못 함). 못 읽으면 '' */
export function cwdFromFirstLine(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const line = buf.toString('utf8', 0, n).split('\n')[0];
    const j = JSON.parse(line);
    const c = (j && j.payload && j.payload.cwd) || (j && j.cwd);
    return typeof c === 'string' ? c : '';
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* 무시 */ }
  }
}

/** 최근 이틀 폴더(YYYY/MM/DD)의 rollout-*.jsonl 중 2분 안에 바뀐 것 → Codex 일하는 카드 */
export function codexSessions(now = Date.now(), root = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const base = path.join(root, 'sessions');
  const out = [];
  const days = [0, 1].map((back) => {
    const d = new Date(now - back * 86400000);
    return path.join(base, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  });
  for (const dir of new Set(days)) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!/^rollout-.*\.jsonl$/.test(n)) continue;
      const f = path.join(dir, n);
      let m;
      try {
        m = fs.statSync(f).mtimeMs;
      } catch {
        continue;
      }
      if (now - m > CODEX_WORKING_MS) continue;
      const cwd = cwdFromFirstLine(f);
      if (cwd) out.push({ id: `codex-${n.slice(0, -6).slice(-24)}`, name: '', tool: 'Codex', cwd, status: 'working', message: '', at: m });
    }
  }
  return out;
}
