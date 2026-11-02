# Genera icone PWA, icone Android e immagini del marchio dal logo originale (grafica/logo-originale.png).
# Uso: python3 scripts/genera-icone.py grafica/logo-originale.png public   (richiede Pillow)
import sys
from PIL import Image, ImageDraw, ImageFilter
SRC = sys.argv[1]; OUT = sys.argv[2]
im = Image.open(SRC).convert('RGB')
emb = im.crop((318, 318, 638, 638)).resize((768, 768), Image.LANCZOS)  # marchio al centro
def emblem_disc(size):
    """Marchio su disco chiaro: la mappa sfuma verso il bianco ai bordi."""
    e = emb.resize((size, size), Image.LANCZOS)
    white = Image.new('RGB', (size, size), (246, 249, 253))
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).ellipse((size*0.05, size*0.05, size*0.95, size*0.95), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(size*0.035))
    disc = Image.composite(e, white, m)
    a = Image.new('L', (size, size), 0)
    ImageDraw.Draw(a).ellipse((0, 0, size-1, size-1), fill=255)
    out = Image.new('RGBA', (size, size)); out.paste(disc, (0, 0), a)
    return out
def bg(size, radius):
    g = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(g)
    for y in range(size):  # blu notte → blu
        t = y / size
        d.line([(0, y), (size, y)], fill=(int(8+t*10), int(20+t*30), int(46+t*50)))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size-1, size-1), radius=radius, fill=255)
    out.paste(g, (0, 0), m)
    return out
def icon(size, disc_ratio, radius_ratio):
    base = bg(size, int(size*radius_ratio))
    ds = int(size*disc_ratio)
    # alone blu attorno al disco
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    o = (size-ds)//2
    ImageDraw.Draw(glow).ellipse((o-size*0.03, o-size*0.03, o+ds+size*0.03, o+ds+size*0.03), fill=(80, 150, 255, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(size*0.03))
    base.alpha_composite(glow)
    base.alpha_composite(emblem_disc(ds), (o, o))
    return base
targets = [('icons/icon-192.png', 192, .80, .22), ('icons/icon-512.png', 512, .80, .22),
           ('icons/apple-touch-icon.png', 180, .80, 0), ('icons/icon-maskable-512.png', 512, .62, 0),
           ('icons/favicon-64.png', 64, .86, .2)]
for name, s, d, r in targets:
    img = icon(s, d, r)
    if name.startswith('icons/apple'): img = img.convert('RGB')
    img.save(f'{OUT}/{name}', optimize=True)
emblem_disc(256).save(f'{OUT}/brand/logo.png', optimize=True)
# immagine completa per la pagina di benvenuto
im.resize((720, int(720*im.height/im.width)), Image.LANCZOS).save(f'{OUT}/brand/sicilia.jpg', quality=84, optimize=True, progressive=True)
# ---- Android (APK)
import os
RES = os.path.join(os.path.dirname(OUT), 'android/app/src/main/res')
for dens, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    icon(s, .80, .22).save(f'{RES}/mipmap-{dens}/ic_launcher.png', optimize=True)
    r = icon(s, .80, .5)
    r.save(f'{RES}/mipmap-{dens}/ic_launcher_round.png', optimize=True)
    fs = int(s * 2.25)  # primo piano dell'icona adattiva: 108dp, contenuto nei 66dp centrali
    fg = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))
    ds = int(fs * 0.58)
    fg.alpha_composite(emblem_disc(ds), ((fs-ds)//2, (fs-ds)//2))
    fg.save(f'{RES}/mipmap-{dens}/ic_launcher_foreground.png', optimize=True)
icon(360, .82, .22).save(f'{RES}/drawable/splash.png', optimize=True)
