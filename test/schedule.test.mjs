// 오늘의 초청 일정 — 설정 검증, 오늘 거르기(시간대), 가짜 PMOTOOLS 서버로 로그인·조회 전 과정, 오류 처리, 비밀번호 비노출.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { dayKey, fetchInvitations, forget, normalizeSchedule, refreshSchedule, scheduleView, todayItems } from '../server/schedule.mjs';
import { normalizeConfig } from '../server/config.mjs';
import { buildSnapshot, forget as forgetSnap } from '../server/snapshot.mjs';
import { forget as forgetAct } from '../server/activity.mjs';
import { forget as forgetSess } from '../server/sessions.mjs';

const SECRET = 'S3cret!@#-pw';
const good = { baseUrl: 'http://pmotools.example:3020/some/path', userId: 'user01', password: SECRET, projectCode: 'PRJ01' };

test('normalizeSchedule: 필수값이 하나라도 없으면 꺼진다(null), 주기는 5~120분, baseUrl 은 origin 만', () => {
  const c = normalizeSchedule({ ...good, refreshMinutes: 1, greeter: ' Rachael ', timeZone: 'Asia/Tokyo' });
  assert.equal(c.baseUrl, 'http://pmotools.example:3020');
  assert.equal(c.refreshMinutes, 5);
  assert.equal(c.greeter, 'Rachael');
  assert.equal(c.timeZone, 'Asia/Tokyo');
  assert.equal(normalizeSchedule({ ...good, refreshMinutes: 999 }).refreshMinutes, 120);
  assert.equal(normalizeSchedule(good).refreshMinutes, 15);
  assert.equal(normalizeSchedule(good).timeZone, 'Asia/Seoul');
  for (const bad of [{ ...good, password: '' }, { ...good, userId: ' ' }, { ...good, projectCode: '' }, { ...good, baseUrl: 'ftp://x' }, { ...good, baseUrl: 'not a url' }, null, [], 'x']) {
    assert.equal(normalizeSchedule(bad), null);
  }
  assert.equal(normalizeSchedule({ ...good, timeZone: 'Nope/Zone' }).timeZone, 'Asia/Seoul');
});

test('todayItems: 오늘(설정 시간대) 시작하는 초청만, 시작 순, 일정·회의실 초청을 같은 모양으로', () => {
  const now = Date.parse('2026-11-11T05:00:00Z'); // 한국 14:00
  const rows = [
    { id: 'a', senderName: '홍길동', isRead: false, calendarInvitation: { title: '[FO] 마이페이지 2차 리뷰', startAt: '2026-11-11T04:30:00.000Z', endAt: '2026-11-11T05:30:00.000Z', allDay: false, location: '본관 22층' } },
    { id: 'b', senderName: '김철수', isRead: true, meetingInvitation: { purpose: '회의실 예약', roomName: '대회의실', startAt: '2026-11-11T00:00:00.000Z', endAt: '2026-11-11T01:00:00.000Z' } },
    { id: 'c', calendarInvitation: { title: '어제', startAt: '2026-11-10T04:00:00.000Z' } },
    { id: 'd', calendarInvitation: { title: '내일', startAt: '2026-11-12T04:00:00.000Z' } },
    { id: 'e', calendarInvitation: { title: '한국 자정 직전(전날 UTC)', startAt: '2026-11-10T15:30:00.000Z' } }, // 한국 11/11 00:30 → 오늘
    { id: 'f', calendarInvitation: { title: '날짜 깨짐', startAt: 'zzz' } },
    { id: 'g', calendarInvitation: null, meetingInvitation: null }, null, 'str',
  ];
  const out = todayItems(rows, now, 'Asia/Seoul');
  assert.deepEqual(out.map((x) => x.id), ['e', 'b', 'a']);
  assert.deepEqual([out[2].title, out[2].location, out[2].sender, out[2].kind, out[2].isRead], ['[FO] 마이페이지 2차 리뷰', '본관 22층', '홍길동', 'calendar', false]);
  assert.deepEqual([out[1].title, out[1].location, out[1].kind], ['회의실 예약', '대회의실', 'meeting']);
  assert.deepEqual(todayItems(rows, now, 'UTC').map((x) => x.id), ['b', 'a']); // 시간대가 다르면 오늘이 다르다
  assert.deepEqual(todayItems('nope', now), []);
  assert.equal(dayKey(now, 'Asia/Seoul'), '2026-11-11');
});

/** 가짜 PMOTOOLS — NextAuth 로그인 흐름(csrf → credentials → 세션 쿠키)과 /api/v1/messages */
function fakeServer({ rows, user = 'user01', pw = SECRET, code = 'PRJ01', messagesStatus = 200 }) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/api/auth/csrf') {
      res.setHeader('set-cookie', 'authjs.csrf-token=abc%7Chash; Path=/; HttpOnly');
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ csrfToken: 'abc' }));
    }
    if (req.url === '/api/auth/callback/credentials' && req.method === 'POST') {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        const f = new URLSearchParams(b);
        const ok = f.get('userId') === user && f.get('password') === pw && f.get('projectCode') === code && f.get('csrfToken') === 'abc' && /authjs\.csrf-token=abc/.test(req.headers.cookie || '');
        if (ok) { res.setHeader('set-cookie', 'authjs.session-token=SESS; Path=/; HttpOnly'); res.writeHead(302, { location: '/' }); } else { res.writeHead(302, { location: '/login?error=CredentialsSignin' }); }
        res.end();
      });
      return;
    }
    if (req.url === '/api/v1/messages') {
      if (!/authjs\.session-token=SESS/.test(req.headers.cookie || '')) { res.writeHead(401); return res.end('{}'); }
      res.writeHead(messagesStatus, { 'content-type': 'application/json' });
      return res.end(messagesStatus === 200 ? JSON.stringify({ data: rows }) : 'oops');
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}
const cfgFor = (url, over = {}) => normalizeSchedule({ ...good, baseUrl: url, ...over });
const rowsToday = (now) => [{ id: 'x', senderName: '홍길동', isRead: true, calendarInvitation: { title: '오늘 회의', startAt: new Date(now + 3600000).toISOString(), endAt: new Date(now + 7200000).toISOString(), allDay: false, location: '22층' } }];

test('fetchInvitations: 로그인 → 초청 목록(올바른 계정)', async () => {
  const now = Date.now();
  const f = await fakeServer({ rows: rowsToday(now) });
  try {
    const rows = await fetchInvitations(cfgFor(f.url));
    assert.equal(rows.length, 1);
    assert.deepEqual(f.hits, ['GET /api/auth/csrf', 'POST /api/auth/callback/credentials', 'GET /api/v1/messages']);
  } finally { f.server.close(); }
});

test('fetchInvitations: 계정이 틀리면 login, 서버 오류면 http, 연결 불가면 network — 오류 문구에 비밀번호가 없다', async () => {
  const f = await fakeServer({ rows: [] });
  try {
    await assert.rejects(fetchInvitations(cfgFor(f.url, { password: 'wrong-pw' })), (e) => e.code === 'login' && !String(e.stack + e.message).includes('wrong-pw'));
    await assert.rejects(fetchInvitations(cfgFor(f.url, { projectCode: 'NOPE' })), (e) => e.code === 'login');
  } finally { f.server.close(); }
  const g = await fakeServer({ rows: [], messagesStatus: 500 });
  try { await assert.rejects(fetchInvitations(cfgFor(g.url)), (e) => e.code === 'http'); } finally { g.server.close(); }
  const h = await fakeServer({ rows: [], messagesStatus: 200 });
  const dead = h.url; h.server.close();
  await assert.rejects(fetchInvitations(cfgFor(dead)), (e) => e.code === 'network' && !String(e.message).includes(SECRET));
});

test('refreshSchedule·scheduleView: 한 번 받아 캐시하고, 주기 전에는 다시 안 받고, 실패해도 이전 목록을 지킨다', async () => {
  forget();
  const now = Date.now();
  const f = await fakeServer({ rows: rowsToday(now) });
  try {
    const cfg = cfgFor(f.url);
    assert.deepEqual(scheduleView(cfg, now).items, []); // 아직 안 받음
    await refreshSchedule(cfg, now);
    let v = scheduleView(cfg, now);
    assert.equal(v.items.length, 1);
    assert.equal(v.error, null);
    assert.equal(v.greeter, 'Rachael');
    assert.equal(refreshSchedule(cfg, now + 60000), null); // 주기(15분) 전
    const calls = f.hits.length;
    f.server.close(); // 서버가 사라진다
    await refreshSchedule(cfg, now + 16 * 60000);
    v = scheduleView(cfg, now + 16 * 60000);
    assert.equal(v.error, 'network');
    assert.equal(v.items.length, 1); // 이전 목록은 그대로
    assert.ok(calls >= 3);
    assert.equal(scheduleView(null, now), null); // 설정이 없으면 기능 꺼짐
  } finally { try { f.server.close(); } catch { /* 이미 닫힘 */ } forget(); }
});

test('보안: 스냅샷·설정 응답 어디에도 비밀번호가 없다', async () => {
  forget();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'office-sched-'));
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
    process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
    fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
    forgetSnap(); forgetAct(); forgetSess();
    const cfg = normalizeConfig({ roster: [{ name: 'Rachael' }, { name: 'Rick' }], schedule: { ...good, baseUrl: 'http://127.0.0.1:1' } });
    assert.ok(cfg.schedule, '설정은 서버 안에서 계정을 들고 있다');
    const snap = await buildSnapshot({ cfg, starts: null, running: new Set(), quota: [], schedule: { items: [], fetchedAt: null, error: null, greeter: 'Rachael' } });
    const json = JSON.stringify(snap);
    assert.ok(!json.includes(SECRET) && !json.includes('user01') && !json.includes('password'), '스냅샷에 계정 정보가 없다');
    assert.equal(snap.people.find((p) => p.name === 'Rachael').greeter, true); // 맞이하는 사람 표시
    assert.equal(snap.people.find((p) => p.name === 'Rick').greeter, undefined);
    assert.equal(snap.schedule.greeter, 'Rachael');
    const off = await buildSnapshot({ cfg: normalizeConfig({ roster: [{ name: 'Rachael' }] }), starts: null, running: new Set(), quota: [] });
    assert.equal(off.schedule, null); // 설정 없으면 기능 꺼짐
    assert.equal(off.people.find((p) => p.name === 'Rachael').greeter, undefined);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
