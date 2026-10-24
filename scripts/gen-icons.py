#!/usr/bin/env python3
"""Genera los iconos PWA/Android de Innerio desde static/innerio-logo.png.

Master cuadrado 1024² + tamaños PWA (192/512/maskable/apple-touch). El logo
es vertical y transparente; se centra sobre un fondo de marca (surfaceBase
del theme innerio light) porque los adaptive/maskable icons no admiten
transparencia. Reproducible: re-ejecutar regenera todo. Dev-only, no shipped.

Uso:  python3 scripts/gen-icons.py   (desde la raíz del repo)
"""

import colorsys
import os

from PIL import Image

SRC = "apps/web/static/innerio-logo.png"
OUT = "apps/web/static/icons"


def hsl(h, s, light):
    r, g, b = colorsys.hls_to_rgb(h / 360, light / 100, s / 100)
    return (round(r * 255), round(g * 255), round(b * 255))


# theme innerio light: surfaceBase = hsl(95,30%,95%), accent = hsl(95,45%,32%)
BG = hsl(95, 30, 95)        # fondo claro de marca
print("background", BG)

logo = Image.open(SRC).convert("RGBA")


def compose(size, coverage):
    """Lienzo cuadrado `size` con fondo BG y el logo centrado ocupando
    `coverage` de la dimensión menor (deja safe-zone para maskable)."""
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    target = int(size * coverage)
    w, h = logo.size
    scale = target / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = logo.resize((nw, nh), Image.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2), resized)
    return canvas


os.makedirs(OUT, exist_ok=True)
targets = [
    ("icon-1024.png", 1024, 0.80),       # master para @capacitor/assets
    ("icon-512.png", 512, 0.80),         # PWA any
    ("icon-192.png", 192, 0.80),         # PWA any
    ("maskable-512.png", 512, 0.60),     # PWA maskable (safe zone ~60%)
    ("apple-touch-icon-180.png", 180, 0.78),
]
for name, size, cov in targets:
    img = compose(size, cov)
    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    print("wrote", path, img.size)
