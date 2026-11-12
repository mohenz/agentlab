// 상주 에이전트(roster) — 설정 검증, 살아 있는 사람과 합치기, 책상 캐릭터 추가, 켜짐/꺼짐, 숨김, 스냅샷 연동.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRoster, normalizeRoster, MAX_ROSTER } from '../server/roster.mjs';
import { normalizeConfig, defaultConfigText } from '../server/config.mjs';
import { buildSnapshot, forget as forgetSnap } from '../server/snapshot.mjs';
import { forget as forgetAct } from '../server/activity.mjs';
import { forget as forgetSess } from '../server/sessions.mjs';

const live = (name, over = {}) => ({ id: `/work/${name}`, name, path: `/work/${name}`, status: 'working', pending: 0, ask: '', sessions: 1, source: 'hook', commits: 10, kid: false, home: null, subs: [], subCount: 0, doing: null, log: [], ...over });

test('normalizeRoster: 이름 없는 항목·중복 이름·이상한 값은 버리고 길이를 자른다', () => {
  const out = normalizeRoster([
    { name: 'Rick Deckard', role: '전략 PMO', tool: 'OpenCode', process: 'opencode.exe' },
    { name: '  ', role: 'x' }, null, 'str', [], { role: '이름 없음' },
    { name: 'rick deckard', role: '중복(대소문자 무시)' },
    { name: 'Rachael', role: 5, tool: {}, match: 7 },
    { name: 'x'.repeat(100), role: 'y'.repeat(200) },
  ]);
  assert.deepEqual(out.map((e) => e.name), ['Rick Deckard', 'Rachael', 'x'.repeat(40)]);
  assert.deepEqual(out[1], { name: 'Rachael', role: '', tool: '', match: '', process: '', floor: '', account: '', gender: '' });
  assert.equal(out[2].role.length, 80);
  assert.deepEqual(normalizeRoster('nope'), []);
  assert.deepEqual(normalizeRoster(undefined), []);
});

test('normalizeRoster: 최대 개수를 넘기지 않는다', () => {
  const many = Array.from({ length: MAX_ROSTER + 10 }, (_, i) => ({ name: `agent-${i}` }));
  assert.equal(normalizeRoster(many).length, MAX_ROSTER);
});

test('설정: roster 가 없으면 빈 배열, 기본 설정 파일에 roster 키가 들어간다', () => {
  assert.deepEqual(normalizeConfig({}).roster, []);
  assert.deepEqual(normalizeConfig({ roster: [{ name: 'A' }] }).roster.map((e) => e.name), ['A']);
  assert.ok(Array.isArray(JSON.parse(defaultConfigText()).roster));
});

test('applyRoster: match 가 살아 있는 사람과 맞으면 그 사람의 이름·역할을 바꾸고 새 캐릭터를 만들지 않는다', () => {
  const people = [live('pmotools'), live('other')];
  applyRoster(people, [{ name: 'Eduardo Gaff', role: '개발', tool: 'Claude Code', match: 'pmotools', process: '' }], { running: new Set() });
  assert.equal(people.length, 2);
  const eddy = people.find((p) => p.path === '/work/pmotools');
  assert.equal(eddy.name, 'Eduardo Gaff');
  assert.equal(eddy.project, 'pmotools');
  assert.equal(eddy.status, 'working'); // 살아 있는 상태는 그대로
  assert.equal(eddy.role, '개발');
  assert.equal(eddy.roster, true);
  assert.equal(eddy.online, true); // process 를 안 적으면 켜짐
});

test('applyRoster: 경로로도 맞출 수 있고, 한 사람이 두 에이전트 이름을 동시에 받지 않는다', () => {
  const people = [live('app')];
  applyRoster(people, [{ name: 'A', match: '/work/app' }, { name: 'B', match: 'app' }], { running: new Set() });
  assert.equal(people.find((p) => p.path === '/work/app').name, 'A');
  const b = people.find((p) => p.name === 'B');
  assert.equal(b.source, 'roster'); // 이미 A 가 가져갔으니 B 는 책상 캐릭터
});

test('applyRoster: 맞는 사람이 없으면 책상에 앉은(쉬는 중) 캐릭터를 올린다', () => {
  const people = [];
  applyRoster(people, [{ name: 'Rachael', role: '회의록', tool: 'OpenCode', match: '', process: '' }], { running: new Set() });
  assert.equal(people.length, 1);
  assert.deepEqual({ id: people[0].id, name: people[0].name, status: people[0].status, source: people[0].source, sessions: people[0].sessions, kid: people[0].kid, path: people[0].path },
    { id: 'roster:Rachael', name: 'Rachael', status: 'rest', source: 'roster', sessions: 0, kid: false, path: '' });
  assert.deepEqual([people[0].subs, people[0].log, people[0].doing, people[0].ask], [[], [], null, '']);
});

test('applyRoster: process 가 떠 있으면 켜짐, 없으면 꺼짐(대소문자 무시)', () => {
  const entry = { name: 'Rick', role: '', tool: '', match: '', process: 'OpenCode.exe' };
  const on = applyRoster([], [entry], { running: new Set(['opencode.exe']) });
  const off = applyRoster([], [entry], { running: new Set(['claude.exe']) });
  assert.equal(on[0].online, true);
  assert.equal(off[0].online, false);
  assert.equal(off[0].status, 'rest'); // 꺼져 있어도 사무실에는 앉아 있다
});

test('applyRoster: hide 에 든 이름은 올리지 않는다', () => {
  const people = applyRoster([], [{ name: 'Hidden', role: '', tool: '', match: '', process: '' }, { name: 'Shown', role: '', tool: '', match: '', process: '' }], { running: new Set(), hide: (n) => n === 'Hidden' });
  assert.deepEqual(people.map((p) => p.name), ['Shown']);
});

test('applyRoster: roster 가 비어 있으면 아무것도 바꾸지 않는다', () => {
  const people = [live('a')];
  assert.equal(applyRoster(people, [], {}), people);
  assert.equal(people.length, 1);
  assert.equal(people[0].roster, undefined);
});

test('스냅샷: 설정의 roster 가 /api/office 의 people 에 상주 에이전트로 나온다', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-roster-'));
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
    process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
    fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
    forgetSnap(); forgetAct(); forgetSess();
    const cfg = normalizeConfig({ roster: [{ name: 'Rick Deckard', role: '전략 PMO', tool: 'OpenCode', process: 'opencode.exe' }, { name: 'Rachael', role: '문서' }], hide: [] });
    const snap = await buildSnapshot({ cfg, starts: null, running: new Set(['opencode.exe']) });
    const rick = snap.people.find((p) => p.name === 'Rick Deckard');
    const rachael = snap.people.find((p) => p.name === 'Rachael');
    assert.equal(rick.source, 'roster');
    assert.equal(rick.role, '전략 PMO');
    assert.equal(rick.online, true);
    assert.equal(rachael.online, true); // process 를 안 적은 에이전트는 켜짐
    assert.equal(snap.version, 1);
    const ids = snap.people.map((p) => p.id);
    assert.deepEqual(ids, [...ids].sort()); // 정렬 유지
    // roster 설정이 없으면 이전과 똑같이 빈 사무실
    const plain = await buildSnapshot({ cfg: normalizeConfig({}), starts: null, running: new Set() });
    assert.equal(plain.people.length, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('성별: f/m 과 한글 표기를 받고, 모르는 값은 비운다. roster 의 gender 가 사람에게 얹힌다', async () => {
  const { normalizeGender } = await import('../server/roster.mjs');
  assert.deepEqual(['f', 'Female', '여', '여자', ' 여성 '].map(normalizeGender), ['f', 'f', 'f', 'f', 'f']);
  assert.deepEqual(['m', 'MALE', '남', '남자', '남성'].map(normalizeGender), ['m', 'm', 'm', 'm', 'm']);
  assert.deepEqual([undefined, '', 'x', 5, null].map(normalizeGender), ['', '', '', '', '']);
  const people = applyRoster([], normalizeRoster([{ name: 'Eduardo Gaff', gender: '여자' }, { name: 'Rick Deckard', gender: 'm' }, { name: 'Rachael' }]), { running: new Set() });
  assert.equal(people.find((p) => p.name === 'Eduardo Gaff').gender, 'f');
  assert.equal(people.find((p) => p.name === 'Rick Deckard').gender, 'm');
  assert.equal(people.find((p) => p.name === 'Rachael').gender, null); // 안 적으면 null
});
