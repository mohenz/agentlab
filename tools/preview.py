"""조립 결과 확인 이미지 — 시트를 회색 바탕에 올리고 칸 선·색 마스크(빨강)를 덧그린다. 사용: python tools/preview.py frog"""
import os, sys
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
sp = sys.argv[1] if len(sys.argv) > 1 else "frog"
names = ["", "2", "3", "phone", "4", "mini", "walk"]
rows = []
for n in names:
    im = Image.open(f"{OUT}/office/{sp}{n}.webp").convert("RGBA"); key = Image.open(f"{OUT}/office/{sp}{n}-key.webp").convert("RGBA")
    bg = Image.new("RGBA", im.size, (96, 120, 112, 255)); bg.alpha_composite(im)
    red = Image.new("RGBA", im.size, (255, 0, 0, 0)); red.putalpha(key.getchannel("A").point(lambda v: int(v * 0.65)))
    bg.alpha_composite(red)
    d = ImageDraw.Draw(bg)
    for i in range(im.width // 220 + 1): d.line([(i * 220, 0), (i * 220, im.height)], fill=(255, 255, 255, 90))
    d.line([(0, 228 - 0), (0, 0)], fill=(0, 0, 0, 0))
    d.line([(0, 280 - 1), (im.width, 280 - 1)], fill=(255, 255, 0, 160))   # 칸 아래 끝(발끝 기준선)
    rows.append((n, bg))
W = max(r.width for _, r in rows); H = sum(r.height + 4 for _, r in rows)
sheet = Image.new("RGBA", (W, H), (30, 30, 30, 255)); y = 0
for n, r in rows: sheet.paste(r, (0, y)); y += r.height + 4
k = 2000 / W; sheet = sheet.resize((2000, round(H * k)), Image.LANCZOS)
sheet.convert("RGB").save(f"{OUT}/preview_{sp}.png"); print(sheet.size)
