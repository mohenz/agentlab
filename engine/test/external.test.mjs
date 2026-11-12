// 외부 에이전트 — 카드 검증, 오래된 카드 제외, Codex 세션 파일(수정 시각·첫 줄 cwd), 알림 스크립트, 스냅샷 연동.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXTERNAL_STALE_MS, codexSessions, cwdFromFirstLine, normalizeExternal, readExternal } from '../server/external.mjs';
import { apply, planFromArgs } from '../hooks/external-notify.mjs';
import { buildSnapshot, forget as forgetSnap } from '../server/snapshot.mjs';
import { normalizeConfig } from '../server/config.mjs';
import { forget as forgetAct } from '../server/activity.mjs';
import { forget as forgetSess } from '../server/sessions.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'office-ext-'));

test('normalizeExternal: id·cwd 필수, 모르는 status 는 rest, 긴 글은 자른다', () => {
  const c = normalizeExternal({ id: 'codex-1', name: 'x'.repeat(100), tool: 'Codex', cwd: '/w/app', status: 'working', message: 'm'.repeat(500), updatedAt: '2026-11-11T00:00:00Z' });
  assert.equal(c.status, 'working');
  assert.equal(c.name.length, 40);
  assert.equal(c.message.length, 200);
  assert.equal(c.at, Date.parse('2026-11-11T00:00:00Z'));
  assert.equal(normalizeExternal({ id: 'a', cwd: '/w', status: 'weird' }).status, 'rest');
  assert.equal(normalizeExternal({ id: 'a' }), null); // cwd 없음
  assert.equal(normalizeExternal({ id: 'a b', cwd: '/w' }), null); // 이상한 id
  assert.equal(normalizeExternal({ cwd: '/w' }, 'from-file').id, 'from-file');
  assert.equal(normalizeExternal([]), null);
});

test('readExternal: 30분 넘게 소식 없는 카드는 빠지고, 깨진 파일은 건너뛴다', () => {
  const dir = tmp();
  try {
    const now = Date.now();
    const w = (n, o) => fs.writeFileSync(path.join(dir, n), typeof o === 'string' ? o : JSON.stringify(o));
    w('fresh.json', { id: 'fresh', cwd: '/w/a', status: 'working', updatedAt: new Date(now - 60000).toISOString() });
    w('old.json', { id: 'old', cwd: '/w/b', status: 'working', updatedAt: new Date(now - EXTERNAL_STALE_MS - 60000).toISOString() });
    w('broken.json', '{ nope');
    w('note.txt', 'x');
    assert.deepEqual(readExternal(now, dir).map((c) => c.id), ['fresh']);
    assert.deepEqual(readExternal(now, path.join(dir, 'missing')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex 세션 파일: 최근에 바뀐 rollout 만, 첫 줄의 cwd 를 쓴다(못 읽으면 건너뜀)', () => {
  const root = tmp();
  try {
    const now = new Date('2026-11-11T12:00:00').getTime();
    const dir = path.join(root, 'sessions', '2026', '11', '11');
    fs.mkdirSync(dir, { recursive: true });
    const live = path.join(dir, 'rollout-2026-11-11T11-59-00-aaaa.jsonl');
    const stale = path.join(dir, 'rollout-2026-11-11T08-00-00-bbbb.jsonl');
    const noCwd = path.join(dir, 'rollout-2026-11-11T11-59-30-cccc.jsonl');
    fs.writeFileSync(live, JSON.stringify({ type: 'session_meta', payload: { cwd: '/w/app' } }) + '\n{"x":1}\n');
    fs.writeFileSync(stale, JSON.stringify({ type: 'session_meta', payload: { cwd: '/w/old' } }) + '\n');
    fs.writeFileSync(noCwd, 'not json\n');
    fs.utimesSync(live, new Date(now - 30000), new Date(now - 30000));
    fs.utimesSync(stale, new Date(now - 3600000), new Date(now - 3600000));
    fs.utimesSync(noCwd, new Date(now - 10000), new Date(now - 10000));
    const out = codexSessions(now, root);
    assert.deepEqual(out.map((c) => [c.cwd, c.status, c.tool]), [['/w/app', 'working', 'Codex']]);
    assert.equal(cwdFromFirstLine(live), '/w/app');
    assert.equal(cwdFromFirstLine(noCwd), '');
    assert.equal(cwdFromFirstLine(path.join(dir, 'nope.jsonl')), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('external-notify: 수동 호출·Codex notify JSON·퇴근, 이상한 입력은 무시', () => {
  const dir = tmp();
  try {
    const at = new Date('2026-11-11T12:00:00Z');
    const manual = planFromArgs(['--id', 'codex-1', '--tool', 'Codex', '--cwd', '/w/app', '--status', 'decision', '--message', '명령 승인'], at);
    assert.equal(apply(manual, dir), 'written');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'codex-1.json'), 'utf8'));
    assert.deepEqual([saved.status, saved.tool, saved.message, saved.cwd], ['decision', 'Codex', '명령 승인', '/w/app']);
    const codex = planFromArgs(['--codex', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'T-9', cwd: '/w/app' })], at);
    assert.equal(codex.write.id, 'codex-T-9');
    assert.equal(codex.write.status, 'rest');
    assert.equal(planFromArgs(['--codex', JSON.stringify({ type: 'other', cwd: '/w' })], at), null);
    assert.equal(planFromArgs(['--codex', 'not json'], at), null);
    assert.equal(planFromArgs(['--id', 'bad id'], at), null);
    assert.equal(apply(planFromArgs(['--id', 'codex-1', '--remove']), dir), 'removed');
    assert.equal(fs.existsSync(path.join(dir, 'codex-1.json')), false);
    assert.equal(apply(null, dir), 'ignored');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('스냅샷: 외부 카드가 사람으로 올라오고(source external, tool), 같은 폴더의 Claude 세션이 없으면 그 도구 이름이 붙는다', async () => {
  const base = tmp();
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
    process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
    fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(base, 'home', 'external'), { recursive: true });
    fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
    const proj = path.join(base, 'work', 'my-codex-app');
    fs.mkdirSync(proj, { recursive: true });
    forgetSnap(); forgetAct(); forgetSess();
    fs.writeFileSync(path.join(base, 'home', 'external', 'codex-1.json'),
      JSON.stringify({ id: 'codex-1', tool: 'Codex', cwd: proj, status: 'decision', message: '명령 승인 기다림', updatedAt: new Date().toISOString() }));
    const snap = await buildSnapshot({ cfg: normalizeConfig({}), starts: null, running: new Set(), quota: [] });
    const p = snap.people.find((x) => x.name === 'my-codex-app');
    assert.ok(p, '외부 카드의 프로젝트가 사람으로 나온다');
    assert.deepEqual([p.source, p.tool, p.status, p.ask], ['external', 'Codex', 'decision', '명령 승인 기다림']);
    assert.equal(p.pending, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
