# agentlab

3D 에이전트 오피스(`AgentLab`)에 쓰는 그림 에셋과, 그것을 엔진 규격으로 조립하는 도구입니다.

## 구성

| 폴더 | 내용 |
|---|---|
| `art/` | 원본 그림. 배경 5장(`bg_*.png`, 1536×1024), 캐릭터 기준 시트(`ref_*.png`), 캐릭터 A·B·꼬마(로봇)의 자세별 그림(`a/`·`b/`·`mini/`, 마젠타 단색 배경) |
| `build/office/` | 조립 결과. 시트 `.webp`(캐릭터별 6종 + 새 상태 시트 `4`, 각각 `-key` 색 마스크 짝), 층 배경 `floor_*.webp`, `atlas.json`, `report.txt` |
| `tools/` | 조립·측정·확인 도구 |

## 다시 만들기

그림을 바꾸면 같은 이름으로 `art/`에 넣고 다시 실행합니다. 필요한 것: Python 3, `pip install Pillow numpy`.

```
python tools/build_sprites.py     # 시트·색 마스크·걷기 시트·아틀라스(약 1분 30초)
python tools/build_floors.py      # 배경: 바깥 흰색을 투명으로, 그림자는 반투명으로
python tools/gen_atlas.py <엔진>/web/office-atlas.js
```

결과(`build/office/*.webp`)를 엔진의 `web/office/`에 복사합니다. 규격: 칸 220×280, 서 있는 키 228, 발끝은 칸 아래 끝, 배경 투명, `-key` 마스크는 프로젝트 색으로 칠할 부분(조끼)만 불투명.

| 도구 | 용도 |
|---|---|
| `build_sprites.py` | 크로마키, 캐릭터별 단일 축척, 칸 배치, 색 마스크, 걷기(4동작 → 8칸) |
| `build_floors.py` | 배경 변환 |
| `gen_atlas.py` | 엔진용 `office-atlas.js` 생성(의자 좌표는 엔진 `office-world.js`와 같아야 함) |
| `grid.py` | 배경 위에 좌표 격자를 그려 자리·통로 좌표를 잴 때 |
| `probe_head.py` · `preview.py` | 포즈별 머리 크기 측정, 조립 결과 확인 이미지 |
| `shot.mjs` · `net404.mjs` · `e2e_floors.mjs` | 헤드리스 Chrome 캡처·404 점검·층 전환 시험(Node 18+, `playwright-core` 필요) |

## 그림에 대해

캐릭터(여성 직원 A, 남성 직원 B, 로봇 꼬마)와 사무실 배경은 이미지 생성 서비스로 만든 자체 그림입니다. 다른 제품의 그림·이름은 포함하지 않았습니다.
