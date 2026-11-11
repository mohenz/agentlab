"""사무실 배경 변환 — art/bg_*.png(흰 바탕) → build/office/floor_<이름>.webp(바깥 투명 + 반투명 그림자). 사용: python tools/build_floors.py"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "office")
NAMES = {"bg_work_warm": "floor_work_warm", "bg_work_blue": "floor_work_blue", "bg_work_green": "floor_work_green", "bg_suite": "floor_suite", "bg_knowledge": "floor_knowledge"}

def convert(src):
    im = Image.open(src).convert("RGB"); rgb = np.asarray(im).astype(np.float32)
    mn = rgb.min(2)
    # 모서리에서 이어진 거의 흰 영역(= 바깥)만 찾는다. 창문·종이처럼 안쪽의 흰색은 건드리지 않는다.
    near = mn > 226
    # 화면 가장자리에서 이어진 거의 흰 영역(= 바깥)만 찾는다(수평·수직 확장 반복). 창문·종이처럼 안쪽의 흰색은 건드리지 않는다.
    region = np.zeros_like(near); region[0, :] = near[0, :]; region[-1, :] = near[-1, :]; region[:, 0] = near[:, 0]; region[:, -1] = near[:, -1]
    while True:
        grown = region.copy()
        grown[1:, :] |= region[:-1, :]; grown[:-1, :] |= region[1:, :]; grown[:, 1:] |= region[:, :-1]; grown[:, :-1] |= region[:, 1:]
        grown &= near
        if grown.sum() == region.sum(): break
        region = grown
    outside = region
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    # 바깥: 흰색 → 투명, 옅은 회색 → 검정 반투명(그림자)
    shadow = np.clip((255.0 - lum) / 70.0, 0, 1) * 0.55
    a = np.where(outside, shadow, 1.0)
    # 판 가장자리(바깥과 맞닿은 안쪽 1~2px)는 흰색과 섞여 있으므로 살짝 투명하게 풀어 후광을 줄인다
    edge = Image.fromarray((outside * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(5))
    ring = (np.asarray(edge) > 0) & ~outside
    a = np.where(ring, np.minimum(a, 0.92), a)
    col = np.where(outside[..., None], 0.0, rgb)
    out = np.dstack([col, a * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), float(outside.mean())

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for src, dst in NAMES.items():
        im, ratio = convert(os.path.join(ROOT, "art", src + ".png"))
        im.save(os.path.join(OUT, dst + ".webp"), "WEBP", quality=93, alpha_quality=100, method=6)
        prev = Image.new("RGBA", im.size, (34, 36, 42, 255)); prev.alpha_composite(im)
        prev.convert("RGB").resize((768, 512), Image.LANCZOS).save(os.path.join(ROOT, "build", f"prev_{dst}.png"))
        print(f"{dst}: 바깥(투명) {ratio:.1%}")
    # 의자 겹침 레이어 — 새 그림의 의자는 캐릭터 그림에 포함돼 있으므로 빈 레이어
    Image.new("RGBA", (1536, 1024), (0, 0, 0, 0)).save(os.path.join(OUT, "chairs.webp"), "WEBP", lossless=True)
