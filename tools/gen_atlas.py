"""build/office/atlas.json + 의자 좌표 → 엔진의 web/office-atlas.js 생성. 사용: python tools/gen_atlas.py <출력 office-atlas.js 경로>
chairs 는 office-world.js 의 OFFICE_DESKS + OFFICE_OVERFLOW 와 같은 순서·좌표여야 한다(앞의 5자리는 책상, 뒤 3자리는 회의실)."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
atlas = json.load(open(os.path.join(ROOT, "build", "office", "atlas.json"), encoding="utf-8"))
SEATS = [(1022, 634), (1177, 654), (650, 834), (900, 869), (1160, 904), (636, 586), (723, 593), (774, 603)]
atlas["chairs"] = [{"box": [x - 38, y - 56, 76, 74], "seat": [x, y], "kid": 12} for x, y in SEATS]
out = sys.argv[1]
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write('"use strict";\n// 자동 생성 — 그림 칸 규격(칸 크기·서 있는 키·자세별 키 비율·걸음 폭·의자 자리). 손으로 고치지 말 것(docs/SPRITES.md, agentlab/tools/gen_atlas.py).\n')
    f.write("const OFFICE_ATLAS = " + json.dumps(atlas, ensure_ascii=False, separators=(", ", ": ")) + ";\n")
print("OK", out, len(atlas["heights"]), "sheets")
