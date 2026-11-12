// 사내망 공개 — 6자리 암호 로그인. 설정 검증, 잠금 규칙, 그리고 이 PC 의 사내망 주소로 들어오는 "다른 PC" 요청의 실제 흐름.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { createOfficeServer } from '../server/server.mjs';
import { createGate, isLoopback, loginPage, normalizeLan, SESSION_COOKIE } from '../server/lan.mjs';
import { normalizeConfig } from '../server/config.mjs';

const PIN = '482916';

test('normalizeLan — 켜져 있어도 6자리 숫자 암호가 없으면 열지 않는다', () => {
  assert.deepEqual(normalizeLan(undefined), { enabled: false, pin: '' });
  assert.deepEqual(normalizeLan({ enabled: true }), { enabled: false, pin: '' });
  assert.deepEqual(normalizeLan({ enabled: true, pin: '12345' }), { enabled: false, pin: '' });
  assert.deepEqual(normalizeLan({ enabled: true, pin: '1234567' }), { enabled: false, pin: '' });
  assert.deepEqual(normalizeLan({ enabled: true, pin: 'abcdef' }), { enabled: false, pin: '' });
  assert.deepEqual(normalizeLan({ enabled: 'yes', pin: PIN }), { enabled: false, pin: PIN });
  assert.deepEqual(normalizeLan({ enabled: true, pin: ` ${PIN} ` }), { enabled: true, pin: PIN });
  assert.deepEqual(normalizeLan({ enabled: true, pin: 1234 }), { enabled: true, pin: '001234' });
  assert.equal(normalizeConfig({ lan: { enabled: true, pin: PIN } }).lan.enabled, true);
  assert.equal(normalizeConfig({}).lan.enabled, false);
});

test('isLoopback', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(a), true);
  for (const a of ['10.1.2.3', '::ffff:10.1.2.3', '', undefined]) assert.equal(isLoopback(a), false);
});

test('gate — 맞는 암호는 세션을, 틀린 암호는 잠금으로', () => {
  let t = 1_000_000;
  const gate = createGate({ pin: PIN, now: () => t });
  const r = gate.login('10.0.0.5', PIN);
  assert.equal(r.ok, true);
  const req = { headers: { cookie: `x=1; ${SESSION_COOKIE}=${r.token}` } };
  assert.equal(gate.authed(req), true);
  assert.equal(gate.authed({ headers: { cookie: `${SESSION_COOKIE}=nope` } }), false);
  assert.equal(gate.authed({ headers: {} }), false);
  t += 13 * 3600 * 1000;                                  // 12시간이 지나면 다시 로그인
  assert.equal(gate.authed(req), false);
});

test('gate — 한 주소가 5번 틀리면 잠기고, 잠긴 동안은 맞는 암호도 받지 않는다', () => {
  let t = 1_000_000;
  const gate = createGate({ pin: PIN, now: () => t });
  for (let i = 0; i < 4; i++) assert.deepEqual(gate.login('10.0.0.9', '000000'), { ok: false, locked: false, retryAfter: 0 });
  const fifth = gate.login('10.0.0.9', '000000');
  assert.equal(fifth.locked, true);
  assert.ok(fifth.retryAfter > 800);
  assert.equal(gate.login('10.0.0.9', PIN).ok, false);    // 잠금 중
  assert.equal(gate.login('10.0.0.10', PIN).ok, true);    // 다른 주소는 영향 없음
  t += 15 * 60 * 1000 + 1000;
  assert.equal(gate.login('10.0.0.9', PIN).ok, true);     // 풀림
});

test('gate — 주소를 바꿔 가며 찍어도 전체 잠금이 걸린다', () => {
  let t = 1_000_000;
  const gate = createGate({ pin: PIN, now: () => t });
  for (let i = 0; i < 20; i++) gate.login(`10.0.1.${i}`, '000000');
  const r = gate.login('10.0.2.1', PIN);                  // 처음 보는 주소 + 맞는 암호도 막힌다
  assert.equal(r.ok, false);
  assert.equal(r.locked, true);
  t += 10 * 60 * 1000 + 1000;
  assert.equal(gate.login('10.0.2.1', PIN).ok, true);
});

test('로그인 창 — 암호 칸 하나, 외부 파일·스크립트 없음', () => {
  const html = loginPage('암호가 맞지 않습니다.');
  assert.match(html, /name="pin"/);
  assert.match(html, /maxlength="6"/);
  assert.match(html, /암호가 맞지 않습니다/);
  assert.doesNotMatch(html, /<script|src=|href=/i);
});

// ---- 실제 서버: 이 PC 의 사내망 주소로 접속하면 서버는 "다른 PC" 로 본다 ----
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

function call(port, host, rawPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host, port, path: rawPath, method, headers: { Host: `${host}:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const form = (pin) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `pin=${pin}` });
const listenAll = (server) => new Promise((resolve) => server.listen(0, '0.0.0.0', () => resolve(server.address().port)));

test('다른 PC — 로그인 전에는 화면·API 모두 막고, 로그인하면 읽기 전용으로 열린다', { skip: !lanIp && '사내망 주소가 없는 환경' }, async () => {
  const server = createOfficeServer({ snapshot: async () => ({ people: [], marker: 'snap' }), lan: { pin: PIN } });
  const port = await listenAll(server);
  try {
    // 로그인 전
    const page = await call(port, lanIp, '/', { headers: { Accept: 'text/html' } });
    assert.equal(page.status, 303);
    assert.equal(page.headers.location, '/login');
    const api = await call(port, lanIp, '/api/office');
    assert.equal(api.status, 401);
    assert.doesNotMatch(api.text, /snap/);
    const login = await call(port, lanIp, '/login');
    assert.equal(login.status, 200);
    assert.match(login.text, /name="pin"/);

    // 틀린 암호
    const bad = await call(port, lanIp, '/login', form('000000'));
    assert.equal(bad.status, 401);
    assert.match(bad.text, /암호가 맞지 않습니다/);
    assert.equal(bad.headers['set-cookie'], undefined);

    // 맞는 암호 → 쿠키 → API
    const ok = await call(port, lanIp, '/login', form(PIN));
    assert.equal(ok.status, 303);
    const cookie = String(ok.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const sid = cookie.split(';')[0];
    const snap = await call(port, lanIp, '/api/office', { headers: { cookie: sid } });
    assert.equal(snap.status, 200);
    assert.match(snap.text, /snap/);
    assert.ok(!snap.text.includes(PIN), '접속 암호가 응답에 실리면 안 된다');
    const cfg = await call(port, lanIp, '/api/config', { headers: { cookie: sid } });
    assert.ok(!cfg.text.includes(PIN));

    // 로그인해도 읽기 전용 — 쓰기 메서드는 막는다. 이미 로그인했으면 로그인 창 대신 화면으로
    assert.equal((await call(port, lanIp, '/api/office', { method: 'POST', headers: { cookie: sid } })).status, 405);
    assert.equal((await call(port, lanIp, '/login', { headers: { cookie: sid } })).status, 303);
  } finally {
    server.close();
  }
});

test('다른 PC — 6번째 시도부터 429, 이 PC(루프백)는 로그인 없이 그대로', { skip: !lanIp && '사내망 주소가 없는 환경' }, async () => {
  const server = createOfficeServer({ snapshot: async () => ({ people: [] }), lan: { pin: PIN } });
  const port = await listenAll(server);
  try {
    for (let i = 0; i < 4; i++) assert.equal((await call(port, lanIp, '/login', form('111111'))).status, 401);
    const locked = await call(port, lanIp, '/login', form('111111'));
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);
    assert.match(locked.text, /시도가 너무 많습니다/);
    assert.equal((await call(port, lanIp, '/login', form(PIN))).status, 429);   // 맞는 암호도 잠금 중엔 거절

    // 이 PC — 훅·상태 점검은 로그인 없이, 엄격한 Host 검사 그대로
    assert.equal((await call(port, '127.0.0.1', '/api/health')).status, 200);
    assert.equal((await call(port, '127.0.0.1', '/api/office')).status, 200);
    const evil = await call(port, '127.0.0.1', '/api/office', { headers: { Host: 'evil.example:80' } });
    assert.equal(evil.status, 403);
  } finally {
    server.close();
  }
});

test('lan 을 안 켜면 — /login 은 없는 경로이고 동작은 예전 그대로', async () => {
  const server = createOfficeServer({ snapshot: async () => ({ people: [] }) });
  const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  try {
    assert.equal((await call(port, '127.0.0.1', '/login')).status, 404);
    assert.equal((await call(port, '127.0.0.1', '/login', form(PIN))).status, 405);
    assert.equal((await call(port, '127.0.0.1', '/api/office')).status, 200);
  } finally {
    server.close();
  }
});
