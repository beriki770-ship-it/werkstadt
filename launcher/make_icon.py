"""make_icon.py — generates launcher/werkstadt.ico: a gold building glyph on ink.
Caller: launcher/install.ps1, once, when the .ico is missing.

No downloads (Smart App Control forbids unsigned fetched binaries anyway) — this
draws the shape itself. Uses PIL when available; otherwise writes a minimal valid
ICO by hand so the shortcut still gets an icon on a PC without PIL installed.
"""
import struct
import sys
from pathlib import Path

OUT = Path(__file__).parent / "werkstadt.ico"
INK = (10, 10, 14, 255)
GOLD = (210, 166, 44, 255)  # #D2A62C — the studio-seal gold, per CLAUDE.md


def with_pil():
    from PIL import Image, ImageDraw

    sizes = [16, 24, 32, 48, 64]
    images = []
    for s in sizes:
        img = Image.new("RGBA", (s, s), INK)
        d = ImageDraw.Draw(img)
        # Three ascending bars — a skyline glyph matching the city the page shows.
        bar_w = max(1, s // 6)
        gap = max(1, s // 10)
        heights = [0.45, 0.7, 0.9]
        x = s // 6
        for h in heights:
            top = int(s - s * h)
            d.rectangle([x, top, x + bar_w, s - 2], fill=GOLD)
            x += bar_w + gap
        images.append(img)
    images[0].save(OUT, format="ICO", sizes=[(s, s) for s in sizes], append_images=images[1:])


def by_hand():
    """Minimal 32x32, 32bpp BGRA, uncompressed-BMP-in-ICO. No PIL required."""
    size = 32
    pixels = bytearray()
    bar_w = 5
    bars = [(2, 14), (9, 9), (16, 4)]  # (x, top) three-bar skyline, hand-drawn
    for y in range(size):
        for x in range(size):
            lit = False
            for bx, top in bars:
                if bx <= x < bx + bar_w and top <= y < size - 1:
                    lit = True
                    break
            color = GOLD if lit else INK
            # BMP rows are bottom-up; ICO stores the AND-XOR DIB the same way.
            pixels += bytes([color[2], color[1], color[0], color[3]])
    # Flip rows bottom-up as BMP requires.
    row_bytes = size * 4
    rows = [pixels[i:i + row_bytes] for i in range(0, len(pixels), row_bytes)]
    pixels = bytearray()
    for row in reversed(rows):
        pixels += row

    bmp_header = struct.pack(
        "<IiiHHIIiiII",
        40, size, size * 2, 1, 32, 0, len(pixels), 0, 0, 0, 0,
    )
    and_mask = bytes((size // 8) * size)  # fully opaque, no transparency bits set
    dib = bmp_header + bytes(pixels) + and_mask

    icondir = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack(
        "<BBBBHHII",
        size, size, 0, 0, 1, 32, len(dib), 6 + 16,
    )
    OUT.write_bytes(icondir + entry + dib)


if __name__ == "__main__":
    try:
        with_pil()
        print(f"wrote {OUT} via PIL")
    except ImportError:
        by_hand()
        print(f"wrote {OUT} by hand (no PIL)")
    sys.exit(0)
