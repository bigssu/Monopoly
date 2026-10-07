#!/usr/bin/env python3
"""
Bake the crying dealer's sob frames for the `sell` cut-in (docs/MONEY-EVENTS.md §14.5).

One still (`public/dealer/sad.webp`, 320 x 320) becomes 6 squash-and-stretch phases with
sprite-gen's deterministic "Breathe" effect (https://github.com/aldegad/sprite-gen, Apache-2.0):
an envelope warp with the bottom edge fixed, the lower torso compressing / widening and everything
above its rigid boundary (head, face, neckerchief, shoulders) copied row for row, only moved up or
down. No AI, no randomness: the same input gives the same bytes. The tool is used here only to bake
the asset; none of its code ships in the app.

Writes (commit both; the app build does not need Python):
  public/dealer/sad-sob.webp      one horizontal sheet, 6 cells x 320 px, alpha
  src/content/fx/sob-sheet.ts     { cells, cell, headDy } (headDy = how far the head moved, sprite px)

Usage:
    python3 -m venv .venv-sob && . .venv-sob/bin/activate
    pip install "git+https://github.com/aldegad/sprite-gen@f7cb0db"   # or: pip install -e <clone>
    python scripts/dealer/bake-sob.py [--depth 0.08] [--preview <dir>]

`--preview` also writes each phase as PNG plus a contact sheet on a dark backdrop, for looking.
"""
import argparse
import io
import os
import sys

import numpy as np
from PIL import Image

try:
    from sprite_gen.effects.breathe import bake_breathe_sequence, recommended_breathe_frames
except ImportError:  # pragma: no cover - a hint, not a fallback
    sys.exit('bake-sob: sprite-gen is not installed (see the header of this script).')

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'public', 'dealer', 'sad.webp')
SHEET = os.path.join(ROOT, 'public', 'dealer', 'sad-sob.webp')
META = os.path.join(ROOT, 'src', 'content', 'fx', 'sob-sheet.ts')

# Breathe settings: one breath across the cycle, the upper torso a tenth of a cycle late.
# depth 0.08 (chosen over 0.10, docs/MONEY-EVENTS.md §14.5): the head travels 22 px (-13..+9) of
# 320 and the jacket's lower half widens a little; 0.10 travels 28 px (-17..+11) and bulges the
# jacket hem and pulls the backpack straps apart on the squash. 0.08 already reads as a sob.
DEFAULT_DEPTH = 0.08
LAG = 0.1
BREATHS = 1
# The face must be rigid down to below the lower lids (SAD_EYES, y <= 0.40 of the sprite): the tears
# are placed on the lids and moved by headDy only.
FACE_ROWS = int(0.45 * 320)


def solid(a: np.ndarray) -> np.ndarray:
    """The solid pixels (alpha >= 128, sprite-gen's `solid_alpha_bbox` rule). The still carries an
    alpha-1 haze over its whole square, which the warp keeps only inside the figure's box."""
    return a[:, :, 3] >= 128


def head_top(a: np.ndarray) -> int:
    """First row with a solid pixel (the cap's crown)."""
    return int(np.argmax(solid(a).any(axis=1)))


def rigid_rows(a0: np.ndarray, a: np.ndarray, top: int, dy: int) -> int:
    """How many rows from the crown down are copied unchanged (within the figure's columns), shifted by dy."""
    cols = np.flatnonzero(solid(a0).any(axis=0))
    x0, x1 = int(cols[0]), int(cols[-1]) + 1
    h = a0.shape[0]
    n = 0
    for y in range(top, h):
        if not 0 <= y + dy < h or not np.array_equal(a0[y, x0:x1], a[y + dy, x0:x1]):
            break
        n += 1
    return n


def defringe(im: Image.Image, reach: int = 12) -> Image.Image:
    """Clean the still's chroma-key tint before warping. Its anti-aliased edge pixels are tinted
    magenta (the key colour); the warp widens edge rows (a squash duplicates edge columns), which
    turned that tint into a visible pink rim on the sleeves. Each edge pixel (alpha 8-249) takes the
    colour of the nearest opaque pixels (within `reach` px) and keeps its alpha: the silhouette is
    exactly the same. The square's near-invisible magenta haze (alpha 1-7) stays as it is: the warp
    finds the figure's row ends on it, and without it its outline pass would also touch the head."""
    a = np.array(im.convert('RGBA')).astype(np.int64)
    a[a[:, :, 3] == 0] = 0  # the warp writes transparent pixels as (0, 0, 0, 0)
    filled = a[:, :, 3] >= 250
    rgb = a[:, :, :3].copy()
    h, w = filled.shape
    for _ in range(reach):
        acc = np.zeros_like(rgb)
        cnt = np.zeros((h, w), dtype=np.int64)
        pad_f = np.pad(filled, 1)
        pad_c = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    f = pad_f[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
                    acc += pad_c[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] * f[:, :, None]
                    cnt += f
        new = ~filled & (cnt > 0)
        rgb[new] = acc[new] // cnt[new][:, None]
        filled |= new
    edge = (a[:, :, 3] >= 8) & (a[:, :, 3] < 250) & filled
    a[edge, :3] = rgb[edge]
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def webp_bytes(img: Image.Image, **opts) -> bytes:
    buf = io.BytesIO()
    img.save(buf, 'WEBP', **opts)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--depth', type=float, default=DEFAULT_DEPTH)
    ap.add_argument('--preview', help='also write the phases as PNG + a contact sheet here')
    ap.add_argument('--dry-run', action='store_true', help='measure only, write nothing in the repo')
    args = ap.parse_args()

    still = defringe(Image.open(SRC))
    cell = still.width
    assert still.height == cell, f'{SRC}: expected a square sprite, got {still.size}'
    cfg = {'depth': args.depth, 'breaths': BREATHS, 'lag': LAG}
    n = recommended_breathe_frames(cfg)
    frames, phases = bake_breathe_sequence([still] * n, cfg)
    arrs = [np.array(f.convert('RGBA')) for f in frames]
    a0 = np.array(still)

    top0 = head_top(a0)
    head_dy = [head_top(a) - top0 for a in arrs]
    for p, a in enumerate(arrs):
        r = rigid_rows(a0, a, top0, head_dy[p])
        if top0 + r < FACE_ROWS:
            sys.exit(f'bake-sob: phase {p}: the face is not rigid (rows {top0}..{top0 + r} only)')
        print(f'phase {p} t={phases[p]:.3f} headDy={head_dy[p]:+d} px  rigid rows {top0}..{top0 + r - 1}')

    sheet = Image.new('RGBA', (cell * n, cell), (0, 0, 0, 0))
    for p, fr in enumerate(frames):
        sheet.paste(fr.convert('RGBA'), (p * cell, 0))
    lossless = webp_bytes(sheet, lossless=True, quality=100, method=6, exact=False)
    lossy = webp_bytes(sheet, quality=92, alpha_quality=100, method=6)
    print(f'sheet {sheet.width}x{sheet.height}: lossless {len(lossless)} B, q92 {len(lossy)} B '
          f'(the still: {os.path.getsize(SRC)} B)')
    # The still itself is a lossy WebP: lossless re-encoding its decoded pixels buys nothing visible
    # and costs several times the bytes. q92 with lossless alpha keeps the silhouette exact.
    data = lossy

    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        for p, fr in enumerate(frames):
            fr.save(os.path.join(args.preview, f'sob-{p}.png'))
        bg = Image.new('RGBA', sheet.size, (38, 52, 68, 255))
        bg.alpha_composite(Image.open(io.BytesIO(data)).convert('RGBA'))
        bg.convert('RGB').save(os.path.join(args.preview, f'sob-sheet-d{args.depth:.2f}.png'))

    if args.dry_run:
        return
    with open(SHEET, 'wb') as fh:
        fh.write(data)
    with open(META, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(
            '// GENERATED by scripts/dealer/bake-sob.py - do not edit.\n'
            '// The crying dealer\'s sob frames (docs/MONEY-EVENTS.md §14.5): public/dealer/sad.webp baked\n'
            f'// with sprite-gen Breathe {{ depth: {args.depth}, breaths: {BREATHS}, lag: {LAG} }}.\n'
            '\n'
            '/** The sheet: `cells` phases side by side, each `cell` px square. */\n'
            "export const SOB_SHEET = 'dealer/sad-sob.webp';\n"
            '\n'
            '/** headDy: per phase, how far the (rigid) head sits below where the still (sad.webp, SAD_EYES) has it, in sprite px. */\n'
            f'export const SOB = {{ cells: {n}, cell: {cell}, headDy: [{", ".join(str(d) for d in head_dy)}] }} as const;\n'
        )
    print(f'wrote {os.path.relpath(SHEET, ROOT)} ({len(data)} B) and {os.path.relpath(META, ROOT)}')


if __name__ == '__main__':
    main()
