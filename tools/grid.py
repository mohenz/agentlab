"""배경 위에 좌표 격자를 그린다(좌표 측정용). 사용: python tools/grid.py <배경이름> [x0 y0 x1 y1 [배율]]"""
import sys
from PIL import Image, ImageDraw
name = sys.argv[1]; box = [int(v) for v in sys.argv[2:6]] if len(sys.argv) >= 6 else [0, 0, 1536, 1024]
zoom = float(sys.argv[6]) if len(sys.argv) >= 7 else 1.0
im = Image.open(f"art/{name}.png").convert("RGB")
d = ImageDraw.Draw(im)
step = 50
for x in range(0, 1536, step):
    major = x % 100 == 0
    d.line([(x, 0), (x, 1024)], fill=(255, 0, 0) if major else (0, 120, 255), width=1)
    if major: d.text((x + 2, 2), str(x), fill=(255, 0, 0)); d.text((x + 2, 1010), str(x), fill=(255, 0, 0))
for y in range(0, 1024, step):
    major = y % 100 == 0
    d.line([(0, y), (1536, y)], fill=(255, 0, 0) if major else (0, 120, 255), width=1)
    if major: d.text((2, y + 2), str(y), fill=(255, 0, 0)); d.text((1510, y + 2), str(y), fill=(255, 0, 0))
im = im.crop(box)
if zoom != 1: im = im.resize((round(im.width * zoom), round(im.height * zoom)), Image.LANCZOS)
im.save(f"build/grid_{name}.png"); print(im.size)
