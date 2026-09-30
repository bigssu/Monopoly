#!/usr/bin/env python3
"""
Build the app's consolidated font subsets (docs/PERFORMANCE.md, "글꼴").

Each face holds the UI's own characters PLUS all 2,350 Hangul syllables of KS X 1001 (the
"complete" modern set used by virtually every Korean name), so a player name typed at Setup renders
from the preloaded face without a late font swap. The remaining rare syllables (11,172 - 2,350) come
from the lazily loaded full-family fallback slices.

Google Fonts splits Korean fonts into ~100 `unicode-range` slices per family/weight. Blink pays
for every slice whenever it resolves a new font (size/weight) and relayouts the whole document
each time a slice finishes loading mid-game, which produced 200-700 ms layouts on a 4x-throttled
CPU. Instead we ship ONE woff2 per face with every glyph the UI can show (all strings in src/,
Latin, punctuation, Hangul jamo), and keep the Google slices only as a lazily used fallback
family for arbitrary player names ('Jua Fallback' / 'Noto Sans KR Fallback' in fonts.css).

Usage (re-run whenever UI text gains characters; `npm test` checks the charset):
    pip install fonttools brotli
    npm pack @expo-google-fonts/jua @expo-google-fonts/noto-sans-kr   # full static TTFs (OFL)
    for f in expo-google-fonts-*.tgz; do mkdir -p "${f%.tgz}" && tar xzf "$f" -C "${f%.tgz}"; done
    python3 scripts/subset-fonts.py --src <dir with the unpacked packages>
"""
import argparse
import glob
import os
import sys

from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'fonts', 'app')

# (output name, file glob inside --src)
FACES = [
    ('jua-400', '**/Jua_400Regular.ttf'),
    ('noto-sans-kr-400', '**/NotoSansKR_400Regular.ttf'),
    ('noto-sans-kr-700', '**/NotoSansKR_700Bold.ttf'),
    ('noto-sans-kr-900', '**/NotoSansKR_900Black.ttf'),
]

# Always included: the Google "latin" slices (so typed Latin names render in-face), arrows /
# symbols the UI uses, and Hangul compatibility jamo (shown while an IME composes a name).
EXTRA_RANGES = [
    (0x20, 0x7E), (0xA0, 0xFF), (0x131, 0x131), (0x152, 0x153), (0x2BB, 0x2BC), (0x2C6, 0x2C6),
    (0x2DA, 0x2DA), (0x2DC, 0x2DC), (0x2000, 0x206F), (0x20A9, 0x20A9), (0x20AC, 0x20AC),
    (0x2122, 0x2122), (0x2190, 0x2199), (0x21BA, 0x21BB), (0x2212, 0x2212), (0x2215, 0x2215),
    (0x2605, 0x2606), (0x3131, 0x318E), (0xFFFD, 0xFFFD),
]


def ksx1001_syllables():
    """The 2,350 precomposed Hangul syllables of KS X 1001 (EUC-KR rows 0xB0-0xC8)."""
    out = set()
    for hi in range(0xB0, 0xC9):
        for lo in range(0xA1, 0xFF):
            try:
                out.add(ord(bytes([hi, lo]).decode('euc_kr')))
            except UnicodeDecodeError:
                pass
    assert len(out) == 2350, len(out)
    return out


def app_chars():
    chars = ksx1001_syllables()
    files = [os.path.join(ROOT, 'index.html')]
    for ext in ('ts', 'css'):
        files += glob.glob(os.path.join(ROOT, 'src', '**', f'*.{ext}'), recursive=True)
    for f in files:
        if '__tests__' in f:
            continue
        with open(f, encoding='utf-8') as fh:
            chars.update(ord(c) for c in fh.read() if ord(c) >= 0x20)
    for a, z in EXTRA_RANGES:
        chars.update(range(a, z + 1))
    return chars


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help='directory containing the unpacked @expo-google-fonts packages')
    args = ap.parse_args()
    chars = app_chars()
    os.makedirs(OUT, exist_ok=True)
    for name, pattern in FACES:
        found = glob.glob(os.path.join(args.src, pattern), recursive=True)
        if not found:
            sys.exit(f'missing source font for {name}: {pattern}')
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        font = subset.load_font(found[0], opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=sorted(chars))
        sub.subset(font)
        path = os.path.join(OUT, f'{name}.woff2')
        subset.save_font(font, path, opts)
        print(f'{name}: {len(font.getBestCmap())} chars, {os.path.getsize(path) / 1024:.0f} kB')
    # The characters the subsets were built for (checked by src/ui/shell/__tests__/fonts.test.ts).
    with open(os.path.join(OUT, 'charset.txt'), 'w', encoding='utf-8') as fh:
        fh.write(''.join(chr(c) for c in sorted(chars) if not 0xD800 <= c <= 0xDFFF))


if __name__ == '__main__':
    main()
