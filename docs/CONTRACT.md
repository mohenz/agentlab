# 3D 사무실 (claude-3d-frog-office) — 구조와 약속

Claude Code 세션 하나하나를 사무실 캐릭터(개구리·카피바라)로 보여 주는 **보기 전용** 로컬 웹 화면.
어떤 IDE·터미널(VS Code, Cursor, JetBrains, iTerm, Windows Terminal …)에서 Claude 를 쓰든 동작해야 한다.
맥·윈도우(·리눅스) 공통. **외부 의존성 0** — Node.js 18+ 표준 라이브러리만 쓴다(npm install 불필요).

## 1. 폴더

| 경로 | 영역 | 내용 |
|---|---|---|
| `hooks/office-hook.mjs` | 백엔드 | Claude Code 훅 수신기 — 세션 카드 1파일 쓰기/지우기 |
| `server/*.mjs` | 백엔드 | 로컬 HTTP 서버, 스냅샷 조립, 대화 기록 꼬리 읽기, 생존 판정, 데모 데이터 |
| `scripts/*.mjs` | 백엔드 | setup(적용)·start·stop·status(doctor)·uninstall |
| `test/*.test.mjs` | 백엔드 | `node --test` 단위 시험 |
| `package.json` | 백엔드 | 의존성 없음. scripts: setup, start, stop, status, uninstall, demo, test |
| `web/*` | 화면 | 정적 화면(index.html·style.css·i18n.js·office-*.js·office/*.webp) |
| `README*.md`, `CLAUDE.md`, `docs/*` | 문서 | 사용 설명·구조·스프라이트 교체 |


## 2. 데이터 흐름

```
Claude Code ──(훅: stdin JSON)──▶ hooks/office-hook.mjs ──▶ ~/.claude-office/sessions/<session_id>.json  (세션 카드)
                                                         ┌─▶ 세션 카드 + 생존 판정(pid)
브라우저 ◀──(3초 폴링 GET /api/office)── server/server.mjs ┼─▶ ~/.claude/projects/**/<session_id>.jsonl 꼬리 (지금 하는 일·로그)
                                                         └─▶ <session_id>/subagents/agent-*.jsonl (서브에이전트)
```

- 상태 폴더: 환경변수 `CLAUDE_OFFICE_HOME` 이 있으면 그것, 없으면 `~/.claude-office`.
- Claude 설정 폴더: 환경변수 `CLAUDE_CONFIG_DIR` 이 있으면 그것, 없으면 `~/.claude`.
- **훅이 없어도 동작해야 한다(대화 기록 대체 모드)**: 훅 카드가 없는 세션도 최근 N분 안에 바뀐 대화 파일
  (`<config>/projects/*/*.jsonl`, 한 단계 아래만 — subagents 폴더 제외)로 찾아 보여 준다. 이 경우 승인 대기는 감지 못 한다.

## 3. 세션 카드 (`sessions/<sid>.json`) — 훅이 쓴다

```json
{ "sessionId": "…", "kind": "working|decision|rest", "message": "승인 문구(decision 일 때)",
  "event": "UserPromptSubmit", "cwd": "/abs/path", "transcriptPath": "/abs/…jsonl",
  "pid": 12345, "pidStart": "Wed Oct 22 10:11:24 2026 (맥·리눅스만, 없으면 생략)",
  "compactTrigger": "manual|auto (PreCompact 때만)", "updatedAt": "2026-10-22T01:02:03.456Z" }
```

| 훅 이벤트 | kind | 비고 |
|---|---|---|
| SessionStart | rest | source=compact 이고 직전 카드의 compactTrigger≠manual 이면 아무것도 안 함(자동 압축 뒤엔 하던 일 계속) |
| UserPromptSubmit | working | |
| PreCompact | working | compactTrigger 기록 |
| Notification | decision 또는 rest | notification_type ∈ {permission_prompt, worker_permission_prompt, agent_needs_input, elicitation_dialog} → decision. 종류가 없으면 문구에 "needs your permission"/"needs your input" → decision. 그 밖(idle_prompt 등) → 카드 그대로 두거나 rest |
| PermissionRequest | decision | message = 도구 이름 등 짧게 |
| Stop | rest | |
| SessionEnd | ended | 카드를 지우지 않고 ended 로 덮어쓴다 — 서버가 숨기고, 대체 모드가 그 세션을 유령으로 다시 띄우지 않게. 1일 뒤 서버가 치운다. 제한시간 1.5초라 pid 찾기 등 느린 일 금지 |

훅 규칙: **어떤 입력·오류에도 exit 0, stdout 출력 없음**, 세션 id 는 `^[A-Za-z0-9._-]+$` 만, 원자적 쓰기(tmp→rename).

설치하는 이벤트는 오래된 것만(SessionStart·UserPromptSubmit·Notification·PermissionRequest·Stop·PreCompact·SessionEnd).
StopFailure·PostCompact 같은 새 이벤트 키는 옛 버전 Claude 의 설정 검증을 깨뜨릴 수 있어 넣지 않는다.
PermissionRequest 는 승인 창이 뜨는 즉시, Notification(permission_prompt)은 약 6초 뒤에 울린다(공식 문서).

## 4. `GET /api/office` 응답

```json
{
  "version": 1,
  "now": "2026-10-22T01:02:03.456Z",
  "floors": [ { "id": "work1", "label": "업무층 1", "count": 3 } ],   // 층 목록과 층별 인원(추가 필드 — 옛 화면은 무시)
  "schedule": { "items": [ { "id": "..", "title": "회의", "startAt": "ISO", "endAt": "ISO|null", "allDay": false, "location": "장소", "sender": "보낸 사람", "kind": "calendar|meeting", "isRead": true } ],
                "fetchedAt": "ISO|null", "error": null, "greeter": "Rachael" },   // 오늘의 초청(설정 schedule 이 없으면 null). error = login|network|http|parse
  "quota": [ { "name": "Claude 주", "period": "주간", "remaining": 37, "resetAt": "ISO|null", "checkedAt": "ISO|null" } ],  // quota.json(수동 입력)
  "hooks": true,
  "demo": false,
  "people": [ Person, … ]
}
```

`hooks` = 훅 카드를 하나라도 읽었는가(또는 settings.json 에 우리 훅이 깔려 있는가). false 면 화면이 "대화 기록만으로 표시 중" 안내를 띄운다.

```jsonc
// Person — 프로젝트(폴더) 하나 = 캐릭터 하나. 같은 폴더의 세션 여러 개는 한 명으로 합친다.
{
  "id": "/Users/me/my-app",        // 안정 키 = 프로젝트 루트(git 최상위, 없으면 cwd) 정규화 경로
  "name": "my-app",                // 표시 이름 = 루트 폴더 이름(같은 이름이 둘이면 "my-app (parent)")
  "path": "/Users/me/my-app",
  "status": "working",             // "working" | "decision" | "rest"  (세션들 중 decision > working > rest)
  "pending": 0,                    // 승인 대기 중인 세션 수
  "ask": "Claude needs your permission to use Bash",   // decision 일 때 문구(≤80자), 아니면 ""
  "sessions": 1,                   // 합쳐진 세션 수
  "source": "hook",                // "hook" | "transcript"(대체 모드로만 잡힌 경우)
  "commits": 123,                  // git rev-list --count HEAD (10분 캐시), 못 세면 null
  "kid": false,                    // commits != null && commits < 50 → 70% 꼬마
  "home": null,                    // "server" 면 서버실에서 일한다(설정 homes 로 지정). 그 밖엔 null
  "floor": "work1",                // 사는 층 id(설정 floorMap·roster.floor, 없으면 defaultFloor) — 화면은 그 층 그림에서만 보여 준다
  "compactions": 0,                // 이 프로젝트 세션들이 압축(PreCompact)한 횟수 합 — 훅이 카드의 compactCount 로 누적
  "context": 45,                   // 마지막 답이 읽은 컨텍스트 ÷ contextWindow, 0~100 정수. 모르면 null
  "account": "주",                 // 설정 accountMap·roster.account 의 짧은 이름. 없으면 null
  "greeter": true,                 // (선택) 설정 schedule.greeter 와 이름이 같은 사람에게만 붙는다 — 대표실에서 오늘 일정을 알려 주는 사람
  "gender": null,                  // 상주 에이전트(roster.gender)의 "f"|"m". 그 밖엔 null — 화면은 gender 가 없으면 Claude Code 세션은 여성 캐릭터, 그 밖의 도구는 이름으로 고른다
  "subs": [ { "id": "a1b2", "type": "Explore", "desc": "find auth code", "doing": Act|null } ],  // 최대 12
  "subCount": 1,                   // 실제로 일하는 서브에이전트 수(12 초과 가능)
  "doing": Act|null,               // 지금 하는 일(가장 최근 활동)
  "log": [ { "at": "ISO", "k": "read", "a": "server.mjs" } ]  // 최근 8개, 오래된 것 → 최신
}
```

**Act** = 활동 한 줄을 언어와 무관하게 표현한 것. 화면(i18n.js)이 언어에 맞게 문장으로 만든다.

```jsonc
{ "k": "read",  "a": "server.mjs" }        // k 목록 ↓, a = 이미 잘라 둔 인자(문자열, 없으면 "")
```

| k | 원천(대화 기록 assistant 블록) | a |
|---|---|---|
| text | type=text | 마크다운 기호 뺀 글 60자 |
| read | Read | 파일 이름(basename) |
| edit | Edit·MultiEdit·NotebookEdit | 파일 이름 |
| write | Write | 파일 이름 |
| bash | Bash | description 44자, 없으면 command 앞 40자 |
| grep | Grep | pattern 24자 |
| glob | Glob | pattern 28자 |
| fetch | WebFetch | URL 호스트 이름 |
| search | WebSearch | query 24자 |
| agent | Agent·Task | description 30자 |
| todo | TodoWrite | "" |
| skill | Skill | skill 이름 24자 |
| mcp | `mcp__서버__도구` | 마지막 토막(도구 이름) |
| tool | 그 밖의 도구 | 도구 이름 24자 |

thinking·빈 글은 건너뛴다. 대화 기록 형식은 Claude Code 내부 형식이라 바뀔 수 있다 — 모르는 모양은 조용히 넘긴다.

## 5. 설정 (`~/.claude-office/config.json`, 없어도 됨)

```json
{ "port": 4777, "autoStart": true, "homes": { "my-main-project": "server" },
  "hide": ["scratch"], "fallbackMinutes": 20, "staleHours": 6, "kidCommits": 50, "lang": "auto",
  "roster": [ { "name": "Rick Deckard", "role": "전략 PMO", "tool": "OpenCode", "process": "opencode.exe", "floor": "suite" } ],
  "floors": [ { "id": "work1", "label": "업무층 1" } ], "floorMap": { "my-main-project": "work2" }, "defaultFloor": "work1" }
```

- `port` — 서버 포트(환경변수 `CLAUDE_OFFICE_PORT` 가 우선). 서버는 **127.0.0.1 에만** 붙는다.
- `autoStart` — SessionStart 훅이 서버가 꺼져 있으면 백그라운드로 띄운다(재부팅 뒤에도 Claude 만 켜면 화면이 산다).
- `homes` — 프로젝트 이름(또는 경로) → "server" 면 그 캐릭터는 서버실에 서서 일한다.
- `hide` — 사무실에 안 띄울 프로젝트 이름·경로.
- `contextWindow` — 컨텍스트 창 크기(토큰, 기본 200000). 1M 컨텍스트 모델을 쓰면 `1000000`. 이름표의 `45%` 가 이 값을 기준으로 한다.
- `accountMap` — 프로젝트 이름(또는 경로) → 짧은 계정 이름(12자, 예: "주"·"부"). 이름표 끝에 붙는다.
- `floors` — 층 목록(`id` 영문·숫자·`_-` 20자, `label` 30자, 최대 12층). 기본은 `work1·work2·work3`(업무층 3색)·`knowledge`(지식층)·`suite`(대표실).
  화면이 그림을 가진 id(`web/office-world.js` 의 `OFFICE_FLOORS`)만 층으로 보여 준다.
- `floorMap` — 프로젝트 이름(또는 경로) → 층 id. 목록에 없는 id 는 버린다. `defaultFloor` — 매핑이 없는 프로젝트가 사는 층(기본 첫 층).
- `lang` — "auto" | "ko" | "en". 화면에 그대로 전달(`GET /api/config`).
- `roster` — **상주 에이전트**. Claude 세션이 없어도 사무실에 앉아 있게 올릴 에이전트(예: OpenCode·Antigravity 로 도는 페르소나) 목록.
  항목은 `{ "name": "Rick Deckard", "role": "전략 PMO", "tool": "OpenCode", "match": "", "process": "opencode.exe" }`.
  - `name` 필수(40자, 대소문자 무시 중복 불가), `role`(80자)·`tool`(60자)은 화면 패널에 보인다. 최대 30개.
  - `match` — 살아 있는 사람(프로젝트 폴더 이름 또는 경로)과 맞으면 그 사람의 이름·역할을 바꾼다(새 캐릭터를 만들지 않는다). 한 사람은 한 에이전트만 받는다.
  - 맞는 사람이 없으면 책상에 앉은(`rest`) 캐릭터를 올린다: `id` = `roster:<name>`, `source` = `"roster"`, `sessions` = 0, `path` = "".
  - `process` — 실행 파일 이름(예: `opencode.exe`). 떠 있으면 `online: true`, 없으면 `false`(꺼져 있어도 사무실에는 앉아 있다). 안 적으면 항상 켜짐.
  - `floor` — 이 에이전트가 사는 층 id(안 적으면 `floorMap`·`defaultFloor` 규칙). `account` — 이름표에 붙일 짧은 계정 이름(12자).
  - `gender` — `"f"`(여성 캐릭터)·`"m"`(남성 캐릭터). `여`·`남`·`female`·`male` 도 받는다. 안 적으면 위 규칙.
  - `hide` 에 든 이름은 올리지 않는다.
  Person 에 `role`·`tool`·`roster: true`·`online`(상주 에이전트일 때), 이름을 바꾼 경우 원래 프로젝트 이름 `project` 가 더해진다.

### 5-0. 오늘의 초청 일정 (`schedule`)

PMOTOOLS 초청함에서 **오늘 시작하는 초청**을 받아 3D 사무실 대표실에서 `greeter`(맞이하는 사람)가 알려 준다.

```json
"schedule": { "baseUrl": "http://pmotools.example:3020", "userId": "user01", "password": "…", "projectCode": "PRJ01",
              "refreshMinutes": 15, "greeter": "Rachael", "timeZone": "Asia/Seoul" }
```

- `baseUrl`·`userId`·`password`·`projectCode` 가 모두 있어야 켜진다(하나라도 없으면 조용히 꺼짐). `refreshMinutes` 5~120(기본 15), `greeter` 기본 `Rachael`, `timeZone` 기본 `Asia/Seoul`(오늘의 기준).
- 서버가 NextAuth 로그인(`/api/auth/csrf` → `/api/auth/callback/credentials`) 후 `GET /api/v1/messages` 를 읽는다. 일정 초청(`calendarInvitation`)과 회의실 초청(`meetingInvitation`)을 같은 모양으로 합친다.
- 실패하면 이전 목록을 지키고 1분 뒤 다시 시도한다. 오류는 코드(`login`·`network`·`http`·`parse`)로만 내보낸다.
- **보안**: 비밀번호는 `config.json` 에 **평문**으로 남는다(사용자가 선택한 방식). 서버는 이 값을 `/api/office`·`/api/config`·로그·오류 문구에 싣지 않는다(시험으로 고정). 이 파일을 공유·백업·커밋하지 말고, PMOTOOLS 비밀번호를 바꾸면 여기도 고친다.
- 화면: `greeter` 가 대표실(`suite`) 로비에서 기다리다가 사용자가 그 층에 들어오면 인사 → 남은 일정(시각·제목, 장소) → 맺음말을 말풍선으로 알려 준다. 오른쪽에 "오늘의 초청" 카드. `greeter` 를 대표실에 두려면 roster 항목에 `"floor": "suite"`.

### 5-1. 계정 남은 한도 (`~/.claude-office/quota.json`, 없어도 됨)

ChatGPT·Grok·Claude 구독의 남은 한도는 공식 조회 API 가 없어 **자동으로 읽지 못한다.** 사용자가 직접 적고, 화면은 확인한 시각과 함께 "마지막 확인값"으로 보여 준다(6시간 넘으면 `*마지막 확인값`).

```json
[ { "name": "Claude 주", "period": "주간", "remaining": 37, "resetAt": "2026-11-15T00:00:00+09:00", "checkedAt": "2026-11-11T09:00:00+09:00" } ]
```

- `name`(24자)·`remaining`(남은 %, 0~100 으로 맞춤) 필수. `period`(12자)·`resetAt`·`checkedAt`(ISO) 은 선택. 최대 12개. 파일이 없거나 깨지면 빈 목록(카드가 안 나온다).

### 5-2. 외부 에이전트 (Codex 등 — `~/.claude-office/external/<id>.json`)

Claude Code 가 아닌 도구도 카드만 쓰면 사무실에 올라온다. 같은 프로젝트 폴더의 Claude 세션이 있으면 한 사람으로 묶인다(상태 우선순위 `decision > working > rest`).

```json
{ "id": "codex-1", "name": "", "tool": "Codex", "cwd": "D:/work/my-app", "status": "working", "message": "명령 승인 기다림", "updatedAt": "ISO" }
```

- `id`·`cwd` 필수, `status` = `working` | `decision` | `rest`(모르는 값은 rest). 30분 넘게 소식이 없으면 사무실에서 빠진다. Person 은 `source: "external"`, `tool` 이 붙는다.
- 쓰는 법: `node hooks/external-notify.mjs --id codex-1 --tool Codex --cwd <폴더> --status working|decision|rest [--message ...]`, 퇴근은 `--remove`.
- **Codex CLI**: `~/.codex/config.toml` 에 `notify = ["node", "<저장소>/hooks/external-notify.mjs", "--codex"]` 를 넣으면 턴이 끝날 때마다 쉬는 중 카드를 쓴다.
  일하는 중은 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`(오늘·어제 폴더) 중 2분 안에 바뀐 파일이 있고 첫 줄에서 작업 폴더(`payload.cwd`)를 읽을 수 있을 때 서버가 알아본다.
  ※ 이 두 가지(notify 인자 모양, 세션 파일의 첫 줄 모양)는 문서·기억에 근거한 것이고 **실제 Codex 기록으로 확인하지 못했다**(개발 PC 에 Codex 기록이 없음). 안 맞으면 `server/external.mjs` 의 `cwdFromFirstLine` 한 곳만 고치면 된다.

## 6. 생존 판정 (세션이 아직 켜져 있나)

1. SessionEnd 를 받으면 카드가 ended 가 된다(숨김).
2. 카드에 pid 가 있으면 그 프로세스가 살아 있어야 한다(`process.kill(pid, 0)`; EPERM 도 살아 있음).
   맥·리눅스는 pidStart(ps lstart, LC_ALL=C)까지 맞춰 pid 재사용에 속지 않는다.
3. pid 가 없으면 `max(카드 updatedAt, 대화 파일 mtime)` 이 `staleHours` 안이어야 한다.
4. 7일 넘은 카드 파일은 서버가 치운다.

상태 보정:
- decision 카드인데 대화 파일이 카드보다 1.5초 넘게 나중에 바뀌었다 → 사용자가 답했다 → working.
- working 카드인데 대화 마지막 줄이 assistant + stop_reason "end_turn" 이고 5초 넘게 조용하거나,
  마지막 user 줄에 "[Request interrupted by user" 가 있다 → rest (Esc 로 끊으면 Stop 훅이 안 울린다).
- working 카드인데 마지막 줄이 API 오류(assistant + `isApiErrorMessage: true` 또는 글이 "API Error" 로 시작) → rest (StopFailure 대신).

## 7. 훅 설치 (`scripts/setup.mjs`)

- `<config>/settings.json` 을 읽어(엄격 JSON, 못 읽으면 **중단**·덮어쓰지 않음) 백업(`settings.json.bak-office-YYYYMMDD-HHMMSS`) 후
  위 이벤트마다 `{ "hooks": [ { "type": "command", "command": CMD, "timeout": 10 } ] }` 를 **추가**(이미 있으면 건너뜀).
- 우리 훅 식별 = command 에 `office-hook.mjs` 가 들어 있음. uninstall 은 그것만 지운다(남의 훅 보존).
- CMD 는 bash·cmd·PowerShell 어디서 돌아도 되게: node 실행 파일 경로에 공백이 없으면 그 절대경로(따옴표 없이),
  있으면 `node`. 스크립트 경로는 **슬래시(/)로 바꾸고 큰따옴표로** 감싼다.
  예) `/opt/homebrew/bin/node "/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"`
      `node "C:/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"`
- 이미 열려 있던 Claude 세션은 훅을 새로 안 읽는다 → 그동안은 대체 모드로 보이고, 다시 켜면(또는 /hooks 확인) 정밀 모드.
