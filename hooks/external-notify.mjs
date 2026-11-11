#!/usr/bin/env node
// 외부 에이전트가 사무실에 소식을 알리는 작은 프로그램 — external 카드(~/.claude-office/external/<id>.json)를 쓴다.
//
//   node hooks/external-notify.mjs --id codex-1 --tool Codex --cwd D:/work/my-app --status working
//   node hooks/external-notify.mjs --id codex-1 --status decision --message "명령 승인 기다림"
//   node hooks/external-notify.mjs --id codex-1 --remove            (퇴근)
//
// Codex CLI 의 notify 로 쓰려면 ~/.codex/config.toml 에 한 줄(경로는 이 저장소 위치로):
//   notify = ["node", "D:/Workspace/claude-3d-frog-office/hooks/external-notify.mjs", "--codex"]
// Codex 는 턴이 끝날 때마다 JSON 한 덩어리를 마지막 인자로 넘긴다({"type":"agent-turn-complete","cwd":...,"thread-id":...}).
// --codex 로 부르면 그 JSON 을 읽어 쉬는 중(rest) 카드를 쓴다. 일하는 중은 Codex 세션 파일이 바뀌는 것으로 서버가 알아본다.
// 항상 조용히 끝난다(0) — 도구의 본 작업을 방해하지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { externalDir, ID_RE, normalizeExternal } from '../server/external.mjs';

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
}

/** argv → 쓸 카드(또는 지울 id). 시험에서 쓴다 */
export function planFromArgs(argv, now = new Date()) {
  const at = now.toISOString();
  if (argv.includes('--codex')) {
    const last = argv[argv.length - 1];
    let j = null;
    try {
      j = JSON.parse(last);
    } catch {
      return null;
    }
    if (!j || typeof j !== 'object' || j.type !== 'agent-turn-complete') return null;
    const thread = String(j['thread-id'] || j.thread_id || 'main').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'main';
    const card = normalizeExternal({ id: `codex-${thread}`, tool: 'Codex', cwd: j.cwd, status: 'rest', message: '', updatedAt: at });
    return card ? { write: card } : null;
  }
  const id = arg(argv, '--id');
  if (!ID_RE.test(id)) return null;
  if (argv.includes('--remove')) return { remove: id };
  const card = normalizeExternal({ id, name: arg(argv, '--name'), tool: arg(argv, '--tool'), cwd: arg(argv, '--cwd') || process.cwd(), status: arg(argv, '--status'), message: arg(argv, '--message'), updatedAt: at });
  return card ? { write: card } : null;
}

export function apply(plan, dir = externalDir()) {
  if (!plan) return 'ignored';
  if (plan.remove) {
    try { fs.rmSync(path.join(dir, `${plan.remove}.json`), { force: true }); } catch { /* 무시 */ }
    return 'removed';
  }
  const c = plan.write;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${c.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id: c.id, name: c.name, tool: c.tool, cwd: c.cwd, status: c.status, message: c.message, updatedAt: new Date(c.at || Date.now()).toISOString() }));
  fs.renameSync(tmp, file);
  return 'written';
}

if (import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href || process.argv[1]?.endsWith('external-notify.mjs')) {
  try {
    apply(planFromArgs(process.argv.slice(2)));
  } catch {
    /* 조용히 */
  }
}
