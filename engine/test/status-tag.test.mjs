// 이름표 값 — 컨텍스트 토큰 읽기, 사용률, 계정, 설정 검증, 스냅샷 연동.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextTokens, scanChunk } from '../server/activity.mjs';
import { accountOf, contextPct } from '../server/snapshot.mjs';
import { normalizeConfig, defaultConfigText } from '../server/config.mjs';
import { applyRoster, normalizeRoster } from '../server/roster.mjs';

test('contextTokens: 새 입력 + 캐시 읽기 + 캐시 만들기, 이상한 값은 0', () => {
  assert.equal(contextTokens({ input_tokens: 10, cache_read_input_tokens: 90000, cache_creation_input_tokens: 500, output_tokens: 7 }), 90510);
  assert.equal(contextTokens({ input_tokens: -5, cache_read_input_tokens: 'x' }), 0);
  assert.equal(contextTokens(null), 0);
  assert.equal(contextTokens(undefined), 0);
});

test('대화 기록: 마지막 assistant 줄의 사용량이 컨텍스트 토큰으로 잡히고, 사이드체인 줄은 무시한다', () => {
  const line = (o) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-11T00:00:00Z', message: { content: [], ...o.message }, ...o.top }) + '\n';
  const buf = Buffer.from(
    line({ message: { usage: { input_tokens: 5, cache_read_input_tokens: 1000 } } }) +
    line({ message: { usage: { input_tokens: 7, cache_read_input_tokens: 150000 } } }) +
    line({ message: { usage: { input_tokens: 9, cache_read_input_tokens: 9999999 } }, top: { isSidechain: true } }),
  );
  assert.equal(scanChunk(buf).acc.ctx, 150007);
});

test('contextPct: 사용률 반올림·상한 100, 모르면 null', () => {
  assert.equal(contextPct(90000, 200000), 45);
  assert.equal(contextPct(999999, 200000), 100);
  assert.equal(contextPct(0, 200000), null);
  assert.equal(contextPct(undefined, 200000), null);
  assert.equal(contextPct(100, 0), null);
});

test('accountOf: 폴더 이름 또는 경로로 계정 이름표를 찾는다', () => {
  const cfg = normalizeConfig({ accountMap: { 'my-app': '주', other: '  부  ', bad: 5, empty: ' ', long: 'x'.repeat(40) } });
  assert.equal(accountOf(cfg, 'my-app', '/x/my-app'), '주');
  assert.equal(accountOf(cfg, 'other', '/x/other'), '부');
  assert.equal(accountOf(cfg, 'nothing', '/x/nothing'), null);
  assert.equal(cfg.accountMap.long.length, 12);
  assert.equal('bad' in cfg.accountMap || 'empty' in cfg.accountMap, false);
});

test('설정: contextWindow 범위, 기본 설정 파일에 들어간다', () => {
  assert.equal(normalizeConfig({}).contextWindow, 200000);
  assert.equal(normalizeConfig({ contextWindow: 1000000 }).contextWindow, 1000000);
  assert.equal(normalizeConfig({ contextWindow: 5 }).contextWindow, 200000);
  const text = JSON.parse(defaultConfigText());
  assert.equal(text.contextWindow, 200000);
  assert.deepEqual(text.accountMap, {});
});

test('상주 에이전트: roster 의 account 를 얹는다', () => {
  const people = applyRoster([], normalizeRoster([{ name: 'Rick', account: '주' }, { name: 'Rachael' }]), { running: new Set() });
  assert.equal(people.find((p) => p.name === 'Rick').account, '주');
  assert.equal(people.find((p) => p.name === 'Rachael').account, null); // 안 적으면 null(계약)
});
