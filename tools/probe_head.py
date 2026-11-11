"""포즈별 머리 크기(머리카락 영역) 측정 + 확인 시트. 사용: python tools/probe_head.py a|b"""
import glob, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def load(p):
    return np.asarray(Image.open(p).convert("RGB")).astype(np.int16)

def fg_mask(im):
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    d = np.sqrt(np.maximum((255 - r) ** 2 + g ** 2 + (255 - b) ** 2, 0))
    return d > 110

def hair_mask(im):
    r, g, b = [im[..., i].astype(float) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    s = (mx - mn) / np.maximum(mx, 1)
    return (r > g + 10) & (g > b + 6) & (s > 0.28) & (s < 0.7) & (mx > 55) & (mx < 185) & fg_mask(im)

def head_metrics(im):
    fg = fg_mask(im); hm = hair_mask(im)
    ys, xs = np.where(fg)
    top, bot = ys.min(), ys.max()
    hy, hx = np.where(hm)
    # 머리 윗부분: 몸 위쪽 45% 안의 머리카락만(아래로 늘어진 꼬리·손 가림 영향 줄임)
    sel = hy < top + 0.45 * (bot - top)
    hy, hx = hy[sel], hx[sel]
    # 가장 위쪽 머리카락 행부터 160px 구간의 가로 폭(머리통)
    h0 = hy.min()
    band = (hy >= h0) & (hy <= h0 + 0.16 * (bot - top))
    return dict(fg=(xs.min(), top, xs.max(), bot), head=(hx[band].min(), h0, hx[band].max(), h0 + 0.16 * (bot - top)), headw=int(hx[band].max() - hx[band].min()), height=int(bot - top))

if __name__ == "__main__":
    who = sys.argv[1] if len(sys.argv) > 1 else "a"
    files = [p for p in sorted(glob.glob(f"art/{who}/*.png")) if "strip" not in p]
    cols = 6; th = 300
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * th, rows * (th + 24)), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(files):
        im = load(p); m = head_metrics(im)
        pil = Image.open(p).convert("RGB"); k = th / pil.height
        t = pil.resize((th, th)); dd = ImageDraw.Draw(t)
        x0, y0, x1, y1 = [v * k for v in m["head"]]; dd.rectangle([x0, y0, x1, y1], outline=(0, 160, 255), width=2)
        sheet.paste(t, ((i % cols) * th, (i // cols) * (th + 24)))
        d.text(((i % cols) * th + 4, (i // cols) * (th + 24) + th + 4), f"{os.path.basename(p)[:-4]} headW={m['headw']} h={m['height']}", fill=(0, 0, 0))
        print(f"{os.path.basename(p):26s} headW={m['headw']:4d} height={m['height']:5d} ratio={m['headw']/m['height']:.3f}")
    sheet.save(f"build/probe_{who}.png")
