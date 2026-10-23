"""Pack the dealer sprites into one atlas the app loads (docs/research/13-image-budget.md).

The 13 sprite sources (scripts/dealer/sprites/<name>.webp, 320 x 320, written by gen-sprites.mjs)
become public/dealer/atlas.webp: a 4 x 4 grid of 256 px cells, 1024 x 1024, in the order of
DEALER_SPRITES (src/ui/dealer/lines.ts; cell i = column i % 4, row i // 4). The dealer shows at most
~280 device px wide (stage --u x 5 at DPR 2), so 256 px cells keep it sharp; one file instead of 13.
Since 2026-10-23 the dealer shows twice that size (stage --u x 10), over the prompt cards: the
sources end in a hard cut at the knees, so the bottom FADE of every cell fades out instead (baked
here, so the app pays nothing for it).

    python scripts/dealer/pack-atlas.py
"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SRC = os.path.join(ROOT, 'scripts', 'dealer', 'sprites')
OUT = os.path.join(ROOT, 'public', 'dealer', 'atlas.webp')
# Keep in step with DEALER_SPRITES in src/ui/dealer/lines.ts (the dealer test checks the count).
NAMES = ['idle', 'talk-a', 'talk-b', 'point', 'cheer', 'surprised', 'sad', 'thinking', 'nervous', 'laugh', 'dice', 'present', 'trophy']
CELL = 256
COLS = 4
# The bottom share of each cell whose alpha fades to 0 (smoothstep), so the cut-off legs melt away.
FADE = 0.16


def fade_bottom(im):
    a = im.getchannel('A')
    start = round(CELL * (1 - FADE))
    px = a.load()
    for y in range(start, CELL):
        u = (y - start + 0.5) / (CELL - start)
        k = 1 - u * u * (3 - 2 * u)
        for x in range(CELL):
            px[x, y] = round(px[x, y] * k)
    im.putalpha(a)
    return im


sheet = Image.new('RGBA', (CELL * COLS, CELL * COLS), (0, 0, 0, 0))
for i, name in enumerate(NAMES):
    im = Image.open(os.path.join(SRC, f'{name}.webp')).convert('RGBA').resize((CELL, CELL), Image.LANCZOS)
    sheet.paste(fade_bottom(im), ((i % COLS) * CELL, (i // COLS) * CELL))
sheet.save(OUT, 'WEBP', quality=88, alpha_quality=90, method=6)
print(f'{OUT}: {sheet.size[0]}x{sheet.size[1]}, {os.path.getsize(OUT) / 1024:.1f} KB')
