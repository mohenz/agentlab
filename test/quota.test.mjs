// 계정 남은 한도 — 검증·정규화, 파일 읽기(없음·깨짐·정상), 스냅샷 연동.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_QUOTA, forget, loadQuota, normalizeQuota } from '../server/quota.mjs';
import { buildSnapshot, forget as forgetSnap } from '../server/snapshot.mjs';
import { normalizeConfig } from '../server/config.mjs';
import { createDemo } from '../server/demo.mjs';

test('normalizeQuota: 이름·숫자가 없는 항목은 버리고, 0~100 으로 맞추고, 날짜를 ISO 로 바꾼다', () => {
  const out = normalizeQuota([
    { name: 'Claude 주', period: '주간', remaining: 37.4, resetAt: '2026-11-15T00:00:00+09:00', checkedAt: 'not a date' },
    { name: '', remaining: 10 }, { name: 'x' }, { name: 'y', remaining: 'abc' }, { name: 'z', remaining: '' }, null, 'str',
    { name: 'over', remaining: 250 }, { name: 'under', remaining: -5 },
  ]);
  assert.deepEqual(out.map((q) => [q.name, q.remaining]), [['Claude 주', 37], ['over', 100], ['under', 0]]);
  assert.equal(out[0].resetAt, '2026-11-14T15:00:00.000Z');
  assert.equal(out[0].checkedAt, null);
  assert.equal(out[0].period, '주간');
});

test('normalizeQuota: { items: [...] } 모양도 받고, 개수 상한과 잘못된 입력', () => {
  assert.equal(normalizeQuota({ items: [{ name: 'a', remaining: 1 }] }).length, 1);
  assert.equal(normalizeQuota(Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, remaining: i }))).length, MAX_QUOTA);
  assert.deepEqual(normalizeQuota('nope'), []);
  assert.deepEqual(normalizeQuota(undefined), []);
});

test('loadQuota: 파일이 없거나 깨지면 빈 목록, 있으면 읽고 바뀌면 다시 읽는다', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-quota-'));
  try {
    process.env.CLAUDE_OFFICE_HOME = base;
    forget();
    assert.deepEqual(loadQuota(), []);
    const f = path.join(base, 'quota.json');
    fs.writeFileSync(f, '{ broken');
    forget();
    assert.deepEqual(loadQuota(), []);
    fs.writeFileSync(f, JSON.stringify([{ name: 'Grok 1', remaining: 55 }]));
    forget();
    assert.equal(loadQuota()[0].name, 'Grok 1');
    fs.writeFileSync(f, JSON.stringify([{ name: 'Grok 1', remaining: 20 }, { name: 'Grok 2', remaining: 90 }]));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000)); // 수정 시각을 확실히 바꾼다
    assert.equal(loadQuota().length, 2);
  } finally {
    forget();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('스냅샷·데모: quota 목록이 들어 있다', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-quota2-'));
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
    process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
    fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
    forgetSnap(); forget();
    fs.writeFileSync(path.join(base, 'home', 'quota.json'), JSON.stringify([{ name: 'Claude 주', remaining: 37 }]));
    const snap = await buildSnapshot({ cfg: normalizeConfig({}), starts: null, running: new Set() });
    assert.deepEqual(snap.quota.map((q) => q.name), ['Claude 주']);
    assert.ok(createDemo(7, Date.now())().quota.length >= 3);
  } finally {
    forget();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
