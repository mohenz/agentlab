"""
3D 사무실 스프라이트 조립 도구 — agentlab/art 의 원본 그림을 엔진 규격(docs/SPRITES.md)의 시트로 만든다.
사용: python tools/build_sprites.py            (기본 출력: agentlab/build/office)
엔진 규격: 칸 220x280, 서 있는 키 228, 발끝=칸 아래 끝, 가로 가운데, 배경 투명, -key = 프로젝트 색 칠할 부분만 불투명한(흰색) 마스크.
종 이름은 엔진 호환을 위해 frog(=캐릭터 A), capy(=캐릭터 B)를 그대로 쓴다.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "art")
OUT = os.path.join(ROOT, "build", "office")
CELL_W, CELL_H, STAND = 220, 280, 228
WALK_FRAMES_REPEAT = 2           # 걷기 4동작을 8칸(엔진 WALK_N=8)으로 두 번 이어 붙인다 — 엔진 코드 수정 없음
SPECIES = {"frog": "a", "capy": "b"}

# 시트 구성: 시트 이름 -> {칸: 원본 파일 이름(확장자 제외)}
SHEETS = {
    "": {0: "base_00_stand", 3: "base_03_sitBack", 4: "base_04_sitFront", 5: "base_05_mug"},
    "2": {1: "2_01_talk", 2: "2_02_laugh", 3: "2_03_sip", 4: "2_04_wave", 5: "2_05_think", 6: "2_06_phone", 7: "2_07_stretch"},
    "3": {3: "3_03_standBack", 5: "3_05_cheer", 6: "3_06_scratch", 7: "3_07_sofaTalk"},
    "phone": {1: "phone_01_phScroll", 2: "phone_02_phText", 3: "phone_03_phLol", 4: "phone_04_sitScroll", 5: "phone_05_sitText", 6: "phone_06_sitBackPhone", 7: "phone_07_sitLol"},
    "4": {0: "4_00_sleepDesk", 1: "4_01_slump", 2: "4_02_raiseHand", 3: "4_03_headDesk", 4: "4_04_readDoc", 5: "4_05_carryBox", 6: "4_06_lanyardGuide"},
}
MINI_SHEET = {0: "mini_00_mStand", 3: "mini_03_mBye", 4: "mini_04_mJump", 5: "mini_05_mSide", 6: "mini_06_mBow"}
SHEET_CELLS = {"": 8, "2": 8, "3": 8, "phone": 8, "4": 8, "mini": 8, "walk": 20}


# ---------------------------------------------------------------------------
# 크로마키(마젠타) — 거리 기반 알파 + 가장자리 번짐 제거
# ---------------------------------------------------------------------------
def chroma_key(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dist = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2)
    alpha = np.clip((dist - 70.0) / (150.0 - 70.0), 0.0, 1.0)          # 70 이하 = 배경, 150 이상 = 전경
    # 번짐 제거: 반투명 가장자리에서 마젠타(적·청 과다) 성분을 녹색 수준으로 낮춘다
    spill = np.clip(np.minimum(r, b) - g, 0, None)
    edge = (alpha > 0) & (alpha < 1)
    k = np.where(edge, 0.85, 0.0)
    r2 = r - spill * k; b2 = b - spill * k
    # 배경이 섞인 가장자리는 알파로 나누어 원색을 복원(언프리멀티플라이)
    out = np.stack([r2, g, b2], -1)
    rgba = np.concatenate([np.clip(out, 0, 255), (alpha * 255)[..., None]], -1).astype(np.uint8)
    # 알파 2px 안쪽 침식으로 남은 분홍 테두리 제거(아주 약하게)
    im = Image.fromarray(rgba, "RGBA")
    a = im.getchannel("A").point(lambda v: 0 if v < 24 else v)
    im.putalpha(a)
    return im


def bbox_of(im, thr=24):
    a = np.asarray(im.getchannel("A"))
    ys, xs = np.where(a > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def resize_premul(im, scale):
    w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    return im.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")


def anchor_x(sprite, mode):
    """스프라이트 안에서 가로 기준점(몸 중심)."""
    a = np.asarray(sprite.getchannel("A")) > 24
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    if mode == "torso":      # 걷기: 허리~몸통 높이의 중심(발이 벌어져도 몸이 흔들리지 않게)
        sel = (ys > top + 0.40 * (bot - top)) & (ys < top + 0.70 * (bot - top))
    else:                    # 기본: 발·의자 바닥 쪽 중심
        sel = ys > bot - 0.12 * (bot - top)
    return float(xs[sel].mean()) if sel.any() else float(xs.mean())


def place(sprite, mode="feet"):
    """칸(220x280)에 발끝을 아래 끝에 맞춰 넣는다. 반환: (칸 이미지, 키 비율, 경고)"""
    x0, y0, x1, y1 = bbox_of(sprite)
    crop = sprite.crop((x0, y0, x1, y1))
    ax = anchor_x(crop, mode)
    cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    px = round(CELL_W / 2 - ax); py = CELL_H - crop.height
    warn = []
    if crop.height > CELL_H: warn.append(f"높이 {crop.height}>{CELL_H}")
    if px < 0 or px + crop.width > CELL_W: warn.append(f"가로 {crop.width} 칸 밖({px})")
    cell.alpha_composite(crop, (max(px, -crop.width), py) if py >= 0 else (px, 0))
    return cell, round(crop.height / STAND, 3), warn


# ---------------------------------------------------------------------------
# 색 마스크 — 회색 조끼(캐릭터), 회색 관절·귀(꼬마)
# ---------------------------------------------------------------------------
def make_key(cell, kind):
    a = np.asarray(cell).astype(np.float32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3] / 255.0
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / np.maximum(mx, 1)
    if kind == "mini":
        sel = (sat < 0.10) & (mx > 120) & (mx < 205)
    else:
        # 조끼는 따뜻한 회색(채도 0.15~0.20, 명도 0.55~0.75). 피부(채도 0.3+)·머리카락(채도 0.5+)·흰 블라우스(명도 0.9+)·푸른 셔츠(b>r)·검은 의자/치마(명도 0.45-)는 뺀다
        sel = (sat < 0.24) & (mx >= 0.50 * 255) & (mx <= 0.82 * 255) & ((b - r) < 12) & ((r - b) < 62)
    if kind != "mini":                         # 신발·바닥 쪽(몸 아래 20%)은 조끼가 아니므로 제외 — 흰 운동화의 그늘이 회색으로 잡히는 것을 막는다
        ys = np.where(al.max(1) > 0.1)[0]
        if len(ys): sel[ys.max() - int(0.20 * (ys.max() - ys.min())):, :] = False
    m = sel.astype(np.float32) * al
    # 한 점짜리 잡티 제거 + 가장자리 부드럽게
    mi = Image.fromarray((m * 255).astype(np.uint8), "L").filter(__import__("PIL.ImageFilter", fromlist=["x"]).MedianFilter(3))
    out = Image.new("RGBA", cell.size, (255, 255, 255, 0))
    out.putalpha(mi)
    return out


# ---------------------------------------------------------------------------
# 걷기 스트립 → 프레임
# ---------------------------------------------------------------------------
def split_frames(im, n):
    a = (np.asarray(im.getchannel("A")) > 24).any(0)
    cols = np.where(a)[0]
    # 세로로 이어진 빈 구간(틈)으로 덩어리를 나눈다
    groups, start = [], cols[0]
    for i in range(1, len(cols)):
        if cols[i] - cols[i - 1] > 12:
            groups.append((start, cols[i - 1] + 1)); start = cols[i]
    groups.append((start, cols[-1] + 1))
    if len(groups) != n:                     # 틈으로 못 나누면 균등 분할
        w = im.width / n
        groups = [(round(i * w), round((i + 1) * w)) for i in range(n)]
    frames = []
    for x0, x1 in groups:
        f = im.crop((x0, 0, x1, im.height))
        frames.append(f.crop(bbox_of(f)))
    return frames


def foot_spread(frame):
    a = np.asarray(frame.getchannel("A")) > 24
    ys, xs = np.where(a)
    sel = ys > ys.max() - 0.10 * (ys.max() - ys.min())
    return float(xs[sel].max() - xs[sel].min())


# ---------------------------------------------------------------------------
def sheet_for(species_dir, key_kind="adult"):
    pass


def build():
    os.makedirs(OUT, exist_ok=True)
    report, heights, strides = [], {}, {}
    for species, d in SPECIES.items():
        stand = chroma_key(os.path.join(ART, d, "base_00_stand.png"))
        sx0, sy0, sx1, sy1 = bbox_of(stand)
        scale = STAND / (sy1 - sy0)                       # 이 캐릭터의 단일 축척(모든 자세 공통)
        report.append(f"[{species}] 축척 {scale:.4f} (서 있는 원본 키 {sy1 - sy0}px → {STAND}px)")
        for sheet, cells in SHEETS.items():
            img = Image.new("RGBA", (CELL_W * SHEET_CELLS[sheet], CELL_H), (0, 0, 0, 0)); key = img.copy()
            hs = [1.0] * SHEET_CELLS[sheet]
            for idx, name in cells.items():
                sp = resize_premul(chroma_key(os.path.join(ART, d, name + ".png")), scale)
                cell, hr, warn = place(sp)
                img.paste(cell, (idx * CELL_W, 0)); key.paste(make_key(cell, "adult"), (idx * CELL_W, 0)); hs[idx] = hr
                if warn: report.append(f"  ! {species}{sheet}[{idx}] {name}: " + ", ".join(warn))
            save(img, f"{species}{sheet}"); save(key, f"{species}{sheet}-key"); heights[f"{species}{sheet}"] = hs
        # 꼬마(서브에이전트) 시트 — 꼬마는 종과 무관하게 같은 로봇 그림을 두 종 이름으로 모두 쓴다
        mscale = None
        img = Image.new("RGBA", (CELL_W * 8, CELL_H), (0, 0, 0, 0)); key = img.copy(); hs = [1.0] * 8
        mstand = chroma_key(os.path.join(ART, "mini", MINI_SHEET[0] + ".png")); mb = bbox_of(mstand)
        mscale = (STAND * 0.62) / (mb[3] - mb[1])        # 꼬마는 어른 키의 약 62%
        for idx, name in MINI_SHEET.items():
            sp = resize_premul(chroma_key(os.path.join(ART, "mini", name + ".png")), mscale)
            cell, hr, warn = place(sp); img.paste(cell, (idx * CELL_W, 0)); key.paste(make_key(cell, "mini"), (idx * CELL_W, 0)); hs[idx] = round(hr, 3)
            if warn: report.append(f"  ! {species}mini[{idx}] {name}: " + ", ".join(warn))
        save(img, f"{species}mini"); save(key, f"{species}mini-key"); heights[f"{species}mini"] = hs

        # 걷기 시트
        walk = Image.new("RGBA", (CELL_W * 20, CELL_H), (0, 0, 0, 0)); wkey = walk.copy(); wh = [1.0] * 20
        spreads = []
        for part, (fname, base) in {"F": ("walk_front_strip.png", 0), "B": ("walk_back_strip.png", 4 * WALK_FRAMES_REPEAT)}.items():
            strip = chroma_key(os.path.join(ART, d, fname)); frames = split_frames(strip, 4)
            med = float(np.median([f.height for f in frames])); wscale = (0.99 * STAND) / med
            for rep in range(WALK_FRAMES_REPEAT):
                for i, f in enumerate(frames):
                    cell, hr, warn = place(resize_premul(f, wscale), "torso"); idx = base + rep * 4 + i
                    walk.paste(cell, (idx * CELL_W, 0)); wkey.paste(make_key(cell, "adult"), (idx * CELL_W, 0)); wh[idx] = hr
                    if warn and rep == 0: report.append(f"  ! {species}walk{part}[{i}]: " + ", ".join(warn))
            if part == "F": spreads = [foot_spread(resize_premul(f, wscale)) for f in frames]
        for part, (fname, base) in {"F": ("walk_front_strip.png", 16), "B": ("walk_back_strip.png", 18)}.items():
            strip = chroma_key(os.path.join(ART, "mini", fname)); frames = split_frames(strip, 2)
            med = float(np.median([f.height for f in frames])); wscale = (STAND * 0.62 * 0.99) / med
            for i, f in enumerate(frames):
                cell, hr, warn = place(resize_premul(f, wscale), "torso"); walk.paste(cell, ((base + i) * CELL_W, 0)); wkey.paste(make_key(cell, "mini"), ((base + i) * CELL_W, 0)); wh[base + i] = hr
        save(walk, f"{species}walk"); save(wkey, f"{species}walk-key"); heights[f"{species}walk"] = wh
        strides[species] = round(max(spreads) / 2, 3)    # 한 동작(4장 = 두 걸음)에서 장당 나아가는 거리 ≈ 발 벌어짐의 절반
        report.append(f"[{species}] 걷기 발 벌어짐 {max(spreads):.1f}px → stride {strides[species]}")
    atlas = dict(cellW=CELL_W, cellH=CELL_H, stand=STAND, heights=heights, strides=strides)
    with open(os.path.join(OUT, "atlas.json"), "w", encoding="utf-8") as f: json.dump(atlas, f, ensure_ascii=False)
    with open(os.path.join(OUT, "report.txt"), "w", encoding="utf-8") as f: f.write("\n".join(report) + "\n")
    print("\n".join(report))


def save(im, name):
    im.save(os.path.join(OUT, name + ".webp"), "WEBP", quality=92, alpha_quality=100, method=6)


if __name__ == "__main__":
    build()
