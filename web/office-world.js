"use strict";
// 사무실 지도 — 층마다 그림(office/<art>.webp, 1536×1024)과 그에 맞춘 월드(통로·벽·자리)가 있다. 좌표는 전부 그림 픽셀 기준이다.
// 월드 3종: work(업무층 1~3 — 색만 다른 같은 구도), knowledge(지식층 — 하단 자리·회의 탁자는 업무층과 같고 검수실이 서재로 바뀜), suite(대표실).
// 이 그림들은 방들이 벽으로 막힌 단면 모형이라, 실제로 걸어 다닐 수 있는 곳만 통로로 잇는다.
// 좌표는 격자를 덮은 그림(agentlab/tools/grid.py)으로 재고, 주소 뒤 ?debug 로 통로·자리·벽을 겹쳐 확인한다.
// 활성 월드는 officeUseWorld(이름)으로 바꾼다 — 아래 OFFICE_* 변수가 그 월드 것으로 갈아 끼워지고, 길 찾기는 OfficePath.rebuild() 로 다시 짠다.
// 대사·화면 문구는 i18n.js, 길 찾기·충돌은 office-path.js.

const OFFICE_W = 1536, OFFICE_H = 1024;

// 그림은 원근법으로 그려져 아래쪽(앞쪽) 가구가 더 크다 — 서 있는 사람 키(그림 픽셀)를 발끝 y 로 정한다.
// 회의실 의자(y≈600)는 폭 54, 하단 칸막이 의자(y≈900)는 폭 72 정도라서 y 가 클수록 키운다.
const OFFICE_STAND_AT = y => Math.max(104, Math.min(172, 124 + (y - 600) * 0.136));

// 층 — id 는 서버 config.json 의 floors(server/config.mjs DEFAULT_FLOORS)와 같다. art = office/<art>.webp
const OFFICE_FLOORS = [
  { id: "work1", art: "floor_work_warm", world: "work" },
  { id: "work2", art: "floor_work_blue", world: "work" },
  { id: "work3", art: "floor_work_green", world: "work" },
  { id: "knowledge", art: "floor_knowledge", world: "knowledge" },
  { id: "suite", art: "floor_suite", world: "suite" },
];

// ---------------------------------------------------------------------------
// 월드 work — 업무층(엘리베이터 앞 로비 → 회의실 앞 복도 → 검수실 앞 → 창고 앞, 로비 아래 가장자리를 따라 하단 칸막이 3칸)
// ---------------------------------------------------------------------------
const WORK_NODES = {
  out: [125, 750], door: [195, 770], inner: [290, 795], lob2: [390, 802], lob3: [470, 812],       // 엘리베이터 → 로비(안내데스크 앞)
  w1: [497, 745], w2: [500, 700], w3: [525, 662],                                                   // 로비 → 회의실 앞 복도(안내데스크 오른쪽 옆길)
  c1: [590, 634], c2: [688, 646], c3: [780, 658], c4: [880, 668],                                   // 회의실 앞 복도
  mtg: [688, 624],                                                                                  // 회의실 문 안쪽
  r0: [950, 673], rv1: [1030, 676], rv2: [1175, 692], st: [1300, 698],                              // 검수실 앞 → 창고 앞
  S0: [520, 830], S1: [600, 846], S2: [720, 862], S3: [850, 876], S4: [980, 894], S5: [1100, 912], S6: [1240, 930], // 하단 자리 앞(가장자리를 따라)
};
const WORK_EDGES = [
  ["out", "door"], ["door", "inner"], ["inner", "lob2"], ["lob2", "lob3"],
  ["lob3", "w1"], ["w1", "w2"], ["w2", "w3"], ["w3", "c1"], ["c1", "c2"], ["c2", "c3"], ["c3", "c4"], ["c2", "mtg"],
  ["c4", "r0"], ["r0", "rv1"], ["rv1", "rv2"], ["rv2", "st"],
  ["lob3", "S0"], ["S0", "S1"], ["S1", "S2"], ["S2", "S3"], ["S3", "S4"], ["S4", "S5"], ["S5", "S6"],
];
const WORK_WALLS = [
  [[500, 610], [672, 634]], [[702, 639], [869, 663]],        // 회의실 앞 유리벽(문 자리 672~702 는 끊어 둔다)
  [[574, 641], [530, 700]], [[530, 700], [510, 760]],         // 하단 첫 칸 왼쪽 칸막이(대각선)
  [[765, 690], [768, 830]], [[1016, 720], [1019, 876]],       // 칸 사이 칸막이(앞쪽 가장자리는 비워 두어 지나다닌다)
];
const WORK_BLOCKS = [
  [[300, 690], [400, 655], [490, 685], [490, 760], [400, 764], [300, 742]],   // 안내데스크
];
const WORK_FLOOR = [
  [40, 750], [75, 728], [230, 726], [232, 580], [500, 590], [520, 625], [560, 632], [870, 670], [900, 672], [1250, 700],
  [1400, 720], [1440, 740], [1320, 945], [1000, 905], [520, 840], [470, 822], [300, 815], [150, 790],
];
// 일하는 자리 — 모니터 앞 의자. seat = 앉은 그림의 발끝(의자 바퀴 아래)보다 18 위.
// 앉은 그림에 의자가 들어 있으므로 배경 의자 위에 같은 자리로 덮어 그린다(의자 폭에 맞춰 키를 정했다).
// via = 의자 뒤쪽 통로 점(의자는 책상을 향하고 있어 뒤에서 들어간다), row = 같은 줄(서브에이전트는 오른쪽 옆자리 쪽으로 줄 선다).
const WORK_REVIEW_DESKS = [
  { seat: [1022, 634], via: "rv1", row: 2 }, { seat: [1177, 654], via: "rv2", row: 2 },      // 검수실 2자리
];
const WORK_CUBICLE_DESKS = [
  { seat: [650, 834], via: "S1", row: 3 }, { seat: [900, 869], via: "S3", row: 3 }, { seat: [1160, 904], via: "S5", row: 3 }, // 하단 3칸
];
// 자리가 모자라면 — 회의 탁자 앞줄 의자에 앉아(등을 보이고) 일한다. chair = 책상 다음 번호(월드마다 다시 매긴다)
const WORK_OVERFLOW = [
  { seat: [636, 586], via: "mtg" }, { seat: [723, 593], via: "mtg" }, { seat: [774, 603], via: "mtg" },
];
const WORK_SPOTS = {
  sofa: [], cafe: [], armchair: [], board: [], server: [],     // 이 그림에는 소파·탕비실·서재 안락의자·서버실 길이 없다 — 그 활동은 건너뛴다
  coffee: [{ at: [345, 792], via: "inner", face: -1 }, { at: [445, 802], via: "lob2", face: -1 }],   // 안내데스크 앞 — 카운터에서 한 잔
  meeting: [{ at: [636, 586], via: "mtg", face: 1 }, { at: [774, 603], via: "mtg", face: 1 }, { at: [723, 593], via: "mtg", face: 1 }],
  stroll: [
    { at: [300, 802], via: "inner" }, { at: [560, 638], via: "w3" }, { at: [880, 668], via: "c4" },
    { at: [1270, 702], via: "st" }, { at: [560, 842], via: "S1" },
  ],
};
const WORK_CHATS = [
  { pts: [[330, 794], [395, 806]], via: "lob2" },
  { pts: [[760, 662], [825, 670]], via: "c3" },
  { pts: [[1270, 706], [1335, 712]], via: "st" },
  { pts: [[950, 678], [1010, 686]], via: "r0" },
];

// ---------------------------------------------------------------------------
// 월드 suite — 대표실(엘리베이터 앞 로비 → 유리문 → 집무실 소파 자리)
// ---------------------------------------------------------------------------
const SUITE_NODES = {
  out: [290, 540], door: [400, 548], lobA: [560, 570], lobB: [660, 640], lobC: [780, 740], lobD: [680, 800],   // 엘리베이터 → 로비 → 안락의자 쪽
  gate: [715, 612], in1: [800, 585], s1: [950, 618], s2: [1100, 610], s3: [1250, 560], s4: [1340, 520],       // 유리문 → 집무실
};
const SUITE_EDGES = [
  ["out", "door"], ["door", "lobA"], ["lobA", "lobB"], ["lobB", "lobC"], ["lobB", "lobD"], ["lobC", "lobD"],
  ["lobB", "gate"], ["gate", "in1"], ["in1", "s1"], ["s1", "s2"], ["s2", "s3"], ["s3", "s4"],
];
const SUITE_WALLS = [[[460, 495], [650, 596]], [[780, 520], [1050, 720]]];
const SUITE_BLOCKS = [[[150, 640], [330, 600], [525, 570], [525, 640], [340, 725], [160, 735]]];   // 안내데스크
const SUITE_FLOOR = [[30, 640], [240, 520], [780, 420], [1000, 380], [1480, 470], [1490, 520], [1060, 720], [580, 990], [30, 700]];
const SUITE_SPOTS = {
  sofa: [{ at: [1010, 540], via: "s1", face: 1 }, { at: [1300, 470], via: "s3", face: -1 }],            // 집무실 소파 둘
  cafe: [], coffee: [], board: [], server: [], meeting: [],
  armchair: [{ at: [655, 790], via: "lobD", face: 1 }, { at: [830, 690], via: "lobC", face: -1 }],      // 로비 안락의자 둘
  stroll: [{ at: [560, 590], via: "lobA" }, { at: [700, 660], via: "lobB" }, { at: [1150, 600], via: "s2" }, { at: [900, 600], via: "in1" }],
};
const SUITE_CHATS = [{ pts: [[600, 585], [665, 600]], via: "lobA" }, { pts: [[1070, 625], [1135, 618]], via: "s2" }];

// ---------------------------------------------------------------------------
// 월드 모음 — knowledge 는 work 에서 검수실 자리를 뺀 것(서재로 바뀌어 책상이 없다)
// ---------------------------------------------------------------------------
const OFFICE_WORLDS = {
  work: { nodes: WORK_NODES, edges: WORK_EDGES, walls: WORK_WALLS, blocks: WORK_BLOCKS, floor: WORK_FLOOR, desks: [...WORK_REVIEW_DESKS, ...WORK_CUBICLE_DESKS],
          overflow: WORK_OVERFLOW, spots: WORK_SPOTS, homes: {}, chats: WORK_CHATS, start: ["inner", "lob2", "c1", "c3", "S2", "S3", "rv1", "st"] },
  knowledge: { nodes: WORK_NODES, edges: WORK_EDGES, walls: WORK_WALLS, blocks: WORK_BLOCKS, floor: WORK_FLOOR, desks: WORK_CUBICLE_DESKS,
               overflow: WORK_OVERFLOW, spots: WORK_SPOTS, homes: {}, chats: WORK_CHATS, start: ["inner", "lob2", "c1", "c3", "S2", "S3", "st"] },
  suite: { nodes: SUITE_NODES, edges: SUITE_EDGES, walls: SUITE_WALLS, blocks: SUITE_BLOCKS, floor: SUITE_FLOOR, desks: [],
           overflow: [], spots: SUITE_SPOTS, homes: {}, chats: SUITE_CHATS, start: ["lobA", "lobB", "lobC", "in1", "s2"] },
};

// 활성 월드 — 다른 파일(office-path.js·office-life.js·office-view.js)이 이 이름으로 읽는다. officeUseWorld 가 갈아 끼운다.
let OFFICE_NODES, OFFICE_EDGES, OFFICE_WALLS, OFFICE_BLOCKS, OFFICE_FLOOR, OFFICE_DESKS, OFFICE_OVERFLOW, OFFICE_SPOTS, OFFICE_HOMES, OFFICE_CHATS, OFFICE_START;
let OFFICE_CHAIRS = [];     // 앉는 자리 목록 — 책상(OFFICE_DESKS) 다음에 회의실 의자(OFFICE_OVERFLOW). [{ seat, kid }]
let OFFICE_WORLD_NAME = "";
const OFFICE_WORLD_LISTENERS = [];

function officeUseWorld(name) {
  const w = OFFICE_WORLDS[name] || OFFICE_WORLDS.work;
  OFFICE_WORLD_NAME = OFFICE_WORLDS[name] ? name : "work";
  OFFICE_NODES = w.nodes; OFFICE_EDGES = w.edges; OFFICE_WALLS = w.walls; OFFICE_BLOCKS = w.blocks; OFFICE_FLOOR = w.floor;
  OFFICE_HOMES = w.homes; OFFICE_CHATS = w.chats; OFFICE_START = w.start;
  OFFICE_DESKS = w.desks;
  // 회의실 의자는 책상 다음 번호(chair)를 받고, 쉬는 자리(meeting)도 같은 의자를 가리킨다
  OFFICE_OVERFLOW = w.overflow.map((o, i) => ({ ...o, chair: w.desks.length + i }));
  const chairOf = at => OFFICE_OVERFLOW.findIndex(o => o.seat[0] === at[0] && o.seat[1] === at[1]);
  OFFICE_SPOTS = Object.fromEntries(Object.entries(w.spots).map(([k, list]) => [k, k === "meeting" ? list.map(s => ({ ...s, chair: w.desks.length + chairOf(s.at) })) : list]));
  OFFICE_CHAIRS = [...OFFICE_DESKS, ...OFFICE_OVERFLOW].map(d => ({ seat: d.seat, kid: 12 }));
  for (const f of OFFICE_WORLD_LISTENERS) f(OFFICE_WORLD_NAME);
}
officeUseWorld("work");

// 코딩할 때 머리 위로 떠오르는 기호(언어와 무관)
const OFFICE_CODE = ["{ }", "</>", "( );", "=>", "01", "git", "fn", "#"];

// 프로젝트별 조끼 색 — 이름으로 고정(켜고 꺼도 같은 색). 서로 잘 갈리는 16색.
const OFFICE_COLORS = [
  "#E74C3C", "#E67E22", "#F1C40F", "#27AE60", "#16A085", "#2E86DE", "#3742FA", "#8E44AD",
  "#E84393", "#8D6E63", "#2C3E50", "#00B8D4", "#7CB342", "#FF7043", "#5F27CD", "#C0392B",
];
