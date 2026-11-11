// 계정 남은 한도 — 사람이 적어 두는 파일(~/.claude-office/quota.json)을 읽어 카드에 보여 준다.
// ChatGPT·Grok·Claude 구독의 남은 한도는 공식 조회 API 가 없어서 자동으로 못 읽는다. 값은 사용자가 직접 적고, 확인한 시각(checkedAt)과 함께 "마지막 확인값"으로 보여 준다.
//   [ { "name": "Claude 주", "period": "주간", "remaining": 37, "resetAt": "2026-11-15T00:00:00+09:00", "checkedAt": "2026-11-11T09:00:00+09:00" } ]
import fs from 'node:fs';
import { quotaFile } from './paths.mjs';

export const MAX_QUOTA = 12;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const iso = (v) => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** 읽은 값 → 검증된 목록. 이름이 없거나 남은 %가 숫자가 아닌 항목은 버린다. remaining 은 0~100 으로 맞춘다 */
export function normalizeQuota(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const name = text(e.name, 24);
    const remaining = Number(e.remaining);
    if (!name || e.remaining === '' || e.remaining === null || !Number.isFinite(remaining)) continue;
    out.push({
      name,
      period: text(e.period, 12),
      remaining: Math.max(0, Math.min(100, Math.round(remaining))),
      resetAt: iso(e.resetAt),
      checkedAt: iso(e.checkedAt),
    });
    if (out.length >= MAX_QUOTA) break;
  }
  return out;
}

let cache = { file: '', mtimeMs: -2, value: [] };

/** quota.json 읽기 — 없거나 깨져도 빈 목록. 파일이 그대로면 다시 안 읽는다 */
export function loadQuota() {
  const file = quotaFile();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    /* 없음 = 빈 목록 */
  }
  if (cache.file === file && cache.mtimeMs === mtimeMs) return cache.value;
  let value = [];
  if (mtimeMs >= 0) {
    try {
      value = normalizeQuota(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
    } catch {
      value = [];
    }
  }
  cache = { file, mtimeMs, value };
  return value;
}

export function forget() {
  cache = { file: '', mtimeMs: -2, value: [] };
}
