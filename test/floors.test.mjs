// 층 — 설정 검증, 사람 배정(floorMap·defaultFloor), 층별 인원, 상주 에이전트의 층, 스냅샷·데모 연동.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_FLOORS, normalizeConfig, normalizeFloors, defaultConfigText } from '../server/config.mjs';
import { buildSnapshot, floorOf, floorSummary, forget as forgetSnap } from '../server/snapshot.mjs';
import { applyRoster, normalizeRoster } from '../server/roster.mjs';
import { createDemo } from '../server/demo.mjs';
import { forget as forgetAct } from '../server/activity.mjs';
import { forget as forgetSess } from '../server/sessions.mjs';

test('normalizeFloors: 잘못된 id·중복·너무 긴 이름을 걸러내고, 하나도 없으면 기본 4개 층', () => {
  const out = normalizeFloors([
    { id: 'a1', label: '  첫째  ' }, { id: 'a1', label: '중복' }, { id: '한글', label: 'x' }, { id: 'ok_2' }, null, 'str',
    { id: 'long', label: 'x'.repeat(100) },
  ]);
  assert.deepEqual(out.map((f) => f.id), ['a1', 'ok_2', 'long']);
  assert.equal(out[0].label, '첫째');
  assert.equal(out[1].label, 'ok_2'); // 이름이 없으면 id
  assert.equal(out[2].label.length, 30);
  assert.deepEqual(normalizeFloors(undefined).map((f) => f.id), DEFAULT_FLOORS.map((f) => f.id));
  assert.deepEqual(normalizeFloors([{ id: '!!' }]).map((f) => f.id), DEFAULT_FLOORS.map((f) => f.id));
  assert.equal(normalizeFloors(Array.from({ length: 30 }, (_, i) => ({ id: `f${i}` }))).length, 12);
});

test('설정: floorMap 은 있는 층 id 만, defaultFloor 는 목록 안의 값만, 기본 설정 파일에 들어간다', () => {
  const c = normalizeConfig({ floorMap: { a: 'work2', b: 'nope', c: 5 }, defaultFloor: 'knowledge' });
  assert.deepEqual(c.floorMap, { a: 'work2' });
  assert.equal(c.defaultFloor, 'knowledge');
  assert.equal(normalizeConfig({ defaultFloor: 'zzz' }).defaultFloor, 'work1');
  assert.equal(normalizeConfig({ floors: [{ id: 'x' }], defaultFloor: 'work1' }).defaultFloor, 'x'); // 목록에 없으면 첫 층
  const text = JSON.parse(defaultConfigText());
  assert.ok(Array.isArray(text.floors) && text.floors.length === 4);
  assert.equal(text.defaultFloor, 'work1');
});

test('floorOf: 폴더 이름 또는 경로로 층을 정하고 없으면 기본 층', () => {
  const cfg = normalizeConfig({ floorMap: { 'my-app': 'work2', '/work/docs': 'suite' }, defaultFloor: 'knowledge' });
  assert.equal(floorOf(cfg, 'my-app', '/x/my-app'), 'work2');
  assert.equal(floorOf(cfg, 'docs', path.resolve('/work/docs').toLowerCase()), 'suite');
  assert.equal(floorOf(cfg, 'other', '/x/other'), 'knowledge');
});

test('floorSummary: 층별 인원을 세고, 모르는 층의 사람은 기본 층으로 옮긴다', () => {
  const cfg = normalizeConfig({ defaultFloor: 'work1' });
  const people = [{ floor: 'work1' }, { floor: 'work2' }, { floor: 'work2' }, { floor: 'ghost' }, {}];
  const out = floorSummary(cfg, people);
  assert.deepEqual(out.map((f) => [f.id, f.count]), [['work1', 3], ['work2', 2], ['knowledge', 0], ['suite', 0]]);
  assert.equal(people[3].floor, 'work1');
});

test('상주 에이전트: roster 의 floor 를 사람에게 얹는다(없으면 얹지 않는다)', () => {
  const roster = normalizeRoster([{ name: 'Rick', floor: 'suite' }, { name: 'Rachael' }]);
  const people = applyRoster([], roster, { running: new Set() });
  assert.equal(people.find((p) => p.name === 'Rick').floor, 'suite');
  assert.equal(people.find((p) => p.name === 'Rachael').floor, undefined);
});

test('스냅샷: 사람마다 floor, 최상위에 floors(인원 포함)', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-floors-'));
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
    process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
    fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
    forgetSnap(); forgetAct(); forgetSess();
    const cfg = normalizeConfig({ roster: [{ name: 'Rick', floor: 'suite' }, { name: 'Rachael' }], defaultFloor: 'work2' });
    const snap = await buildSnapshot({ cfg, starts: null, running: new Set() });
    assert.equal(snap.version, 1);
    assert.equal(snap.people.find((p) => p.name === 'Rick').floor, 'suite');
    assert.equal(snap.people.find((p) => p.name === 'Rachael').floor, 'work2'); // 기본 층
    const byId = Object.fromEntries(snap.floors.map((f) => [f.id, f.count]));
    assert.equal(byId.suite, 1);
    assert.equal(byId.work2, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('데모: 사람마다 floor 가 있고 floors 인원 합 = 사람 수', () => {
  const s = createDemo(7, Date.now())();
  assert.ok(s.people.every((p) => typeof p.floor === 'string'));
  assert.equal(s.floors.reduce((n, f) => n + f.count, 0), s.people.length);
  assert.ok(new Set(s.people.map((p) => p.floor)).size >= 3); // 여러 층을 보여 준다
});
