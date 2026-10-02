#!/usr/bin/env python3
"""数回（Slitherlink）的视觉母题工厂：一套位图全部由这份脚本现算，删掉重跑可复现。

母题就是玩法本身：深海军蓝的点阵盘底（field #22304F）+ 灰蓝格线（gridLine #3A4C78）
+ 格点（dot #5A6E9E）+ 一条**琥珀色闭环**（accent #FFC85C，玩家的手）+ 墨白提示数字。
颜色一律取自 js/theme.js 的 Palette，图标和盘面因此不会是两套配色。

产出（全部是真实 PNG，无一张占位）：
  icons/icon-1024.png            母图
  icons/icon-{512,192,180,96,32,16}.png
  icons/icon-maskable-512.png    安全区内收（Android maskable）
  icons/apple-touch-icon.png     180
  icons/favicon-{32,16}.png
  assets/social/og-1280x640.png  社交卡
  assets/textures/lattice-512.png   可平铺点阵纹理（CSS 面板底纹）
  assets/sprites/ripple-128.png     落笔涟漪贴图（canvas 运行时贴图）

用法: python3 assets/gen/make_art.py            # 全部重写
      python3 assets/gen/make_art.py --check    # 只校对盘上产物的类型与宽高，不写文件
"""
import argparse
import math
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))  # 仓根

# 与 js/theme.js 的 Palette 一一对应（改了那边要改这里，两边都是同一批十六进制）
BG_TOP = (7, 10, 20)        # #070A14
BG_BOTTOM = (18, 26, 44)    # #121A2C
SURFACE = (15, 21, 38)      # #0F1526
FIELD = (34, 48, 79)        # #22304F
GRID_LINE = (58, 76, 120)   # #3A4C78
DOT = (90, 110, 158)        # #5A6E9E
INK = (242, 245, 251)       # #F2F5FB
ACCENT = (255, 200, 92)     # #FFC85C
ACCENT_EDGE = (255, 227, 166)
CROSS = (255, 92, 122)      # #FF5C7A
INFO = (123, 184, 255)      # #7BB8FF

FONT_CANDIDATES = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
]


def font_path():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def load_font(px):
    p = font_path()
    if not p:
        return None
    try:
        return ImageFont.truetype(p, px)
    except Exception:
        return None


# ---------------------------------------------------------------- 母题图形

def vertical_gradient(size):
    """#070A14 → #121A2C 的竖向渐变，图标与社交卡共用这一层底色。"""
    w, h = size
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def lattice(d, box, cols, rows, line_w, dot_r, inset=0.0):
    """在 box 里画 cols×rows 个格点的点阵：格线 + 交叉处的圆点。

    数回的边是**点与点之间**那段线，所以母题里格点必须显眼——它们是玩家真正的控件。
    """
    x0, y0, x1, y1 = box
    if inset:
        cw = (x1 - x0) / max(1, cols)
        ch = (y1 - y0) / max(1, rows)
        x0 += cw * inset
        y0 += ch * inset
        x1 -= cw * inset
        y1 -= ch * inset
    step_x = (x1 - x0) / max(1, cols)
    step_y = (y1 - y0) / max(1, rows)

    for i in range(cols + 1):
        x = x0 + i * step_x
        d.line([(x, y0), (x, y1)], fill=GRID_LINE, width=max(1, line_w))
    for j in range(rows + 1):
        y = y0 + j * step_y
        d.line([(x0, y), (x1, y)], fill=GRID_LINE, width=max(1, line_w))
    r = max(1.0, dot_r)
    for i in range(cols + 1):
        for j in range(rows + 1):
            cx, cy = x0 + i * step_x, y0 + j * step_y
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT)
    return {'x0': x0, 'y0': y0, 'step_x': step_x, 'step_y': step_y, 'cols': cols, 'rows': rows}


def loop_points(g):
    """一条不自交恰好闭合的矩形路径，走点阵上的格点（这就是「一条闭环」）。

    坐标是点阵索引 (i, j)，画的时候映射回像素。选这一形状是因为它是数回里最常见的那种环：
    贴着提示数字绕一圈，度数全为 2。
    """
    idx = [(1, 0), (3, 0), (3, 1), (4, 1), (4, 3), (2, 3), (2, 2), (0, 2), (0, 1), (1, 1)]
    return [idx[i % len(idx)] for i in range(len(idx))] + [idx[0]]


def draw_loop(d, g, points, width, color, glow=None):
    px = [(g['x0'] + i * g['step_x'], g['y0'] + j * g['step_y']) for (i, j) in points]
    if glow:
        d.line(px, fill=glow, width=int(width * 2.4), joint='curve')
    d.line(px, fill=color, width=int(width), joint='curve')
    r = width / 2.0
    for (x, y) in (px[0], px[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)


def cross_marks(d, g, positions, size, width, color):
    for (i, j) in positions:
        cx, cy = g['x0'] + i * g['step_x'], g['y0'] + j * g['step_y']
        h = size / 2.0
        d.line([cx - h, cy - h, cx + h, cy + h], fill=color, width=width)
        d.line([cx - h, cy + h, cx + h, cy - h], fill=color, width=width)


def icon_master(size=1024, maskable=False):
    """母图：圆角方章里的点阵 + 琥珀闭环 + 一个提示数字。

    maskable 版本把整幅内容收进中央 80% 安全区（Android 会任意裁切外圈），
    所以它不是"同一张图加白边"，而是按更小的内框重画一遍几何。
    """
    img = vertical_gradient((size, size)).convert('RGBA')
    d = ImageDraw.Draw(img)
    pad = int(size * (0.16 if maskable else 0.06))
    inner = (pad, pad, size - pad, size - pad)
    radius = int(size * (0.14 if maskable else 0.18))

    # 盘底：field 色圆角块，和 canvas 里那块 roundRect 是同一个东西
    d.rounded_rectangle(list(inner), radius=radius, fill=FIELD + (255,))

    g = lattice(d, inner, 4, 4, line_w=max(2, size // 340), dot_r=size * 0.011, inset=0.16)
    draw_loop(d, g, loop_points(g), width=size * 0.045, color=ACCENT,
              glow=(255, 214, 130, 60))
    cross_marks(d, g, [(2, 1)], size=size * 0.028, width=max(2, size // 400), color=CROSS)

    # 提示数字：写在 (1,1)-(2,2) 那一格里，墨白，跟盘面上那批数字同源
    cell_cx = g['x0'] + 1.5 * g['step_x']
    cell_cy = g['y0'] + 1.5 * g['step_y']
    fnt = load_font(int(size * 0.115))
    if fnt is not None:
        d.text((cell_cx, cell_cy), '3', font=fnt, fill=INK, anchor='mm')
    else:
        r = size * 0.05
        d.ellipse([cell_cx - r, cell_cy - r, cell_cx + r, cell_cy + r], fill=INK)

    if not maskable:
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), rounded_mask((size, size), int(size * 0.225)))
        return out
    return img


def derive(master, sizes):
    out = {}
    for s in sizes:
        im = master.resize((s, s), Image.LANCZOS)
        out[s] = im
    return out


def texture_lattice(side=512):
    """可平铺的点阵底纹：格线与格点都落在瓦片边界上，横竖平移不露缝。

    只给 DOM 面板当底纹用（CSS background），不参与 canvas 取色——门禁按 field 色
    容差 8 数像素，往盘面上叠任何纹理都会把那条断言洗掉。
    """
    img = Image.new('RGBA', (side, side), SURFACE + (0,))
    d = ImageDraw.Draw(img)
    step = side // 4
    faint = (58, 76, 120, 46)
    for i in range(0, side + 1, step):
        d.line([(i, 0), (i, side)], fill=faint, width=1)
        d.line([(0, i), (side, i)], fill=faint, width=1)
    r = max(1, side // 220)
    soft = (90, 110, 158, 58)
    for i in range(0, side + 1, step):
        for j in range(0, side + 1, step):
            d.ellipse([i - r, j - r, i + r, j + r], fill=soft)
    # 一层极淡的噪点，让纹理在近看时不是纯色块；固定步长保证可复现
    px = img.load()
    for y in range(side):
        for x in range(0, side, 3):
            n = ((x * 7 + y * 13) % 17) - 8
            if n <= 0:
                continue
            r0, g0, b0, a0 = px[x, y]
            px[x, y] = (min(255, r0 + n), min(255, g0 + n), min(255, b0 + n), max(a0, 10))
    return img


def sprite_ripple(side=128):
    """落笔涟漪贴图：一圈空心环，中心完全透明。

    中心的透明不是审美选择而是门禁要求——验收场景在**边中点**取像素断言环色，
    贴图若在中点落墨就会量出一个假色。运行时按 dt 放大这一圈并淡出。
    """
    img = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = side / 2.0
    band_w = side * 0.055
    for k in range(3):
        rr = side * (0.30 + 0.085 * k)
        alpha = int(255 * (1.0 - k * 0.34))
        for t in range(max(1, int(band_w))):
            f = (t / max(1, band_w))
            a = int(alpha * (1 - f) * 0.9)
            r = rr + t - band_w / 2
            d.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, a), width=1)
    return img


def og_card(w=1280, h=640):
    """社交卡：左半边母题（点阵 + 闭环），右半边商品名与一句话规则。"""
    img = vertical_gradient((w, h)).convert('RGBA')
    d = ImageDraw.Draw(img)
    box = (60, 90, 60 + h - 180, h - 90)
    d.rounded_rectangle(list(box), radius=44, fill=FIELD + (255,))
    g = lattice(d, box, 4, 4, line_w=3, dot_r=6.5, inset=0.14)
    draw_loop(d, g, loop_points(g), width=16, color=ACCENT, glow=(255, 200, 92, 60))
    cross_marks(d, g, [(2, 1)], size=16, width=4, color=CROSS)

    tx = h - 20
    fnt_big = load_font(96)
    fnt_mid = load_font(40)
    fnt_small = load_font(28)
    if fnt_big:
        d.text((tx, 150), '数回', font=fnt_big, fill=INK)
    if fnt_mid:
        d.text((tx, 268), 'Slitherlink · 恰好一条闭环', font=fnt_mid, fill=ACCENT)
    if fnt_small:
        for k, line in enumerate([
            '格子里的数字 = 这一格四条边里在环上的条数',
            '每一局都由引擎验过：唯一可解，铅笔零猜测推到底',
            '判胜只有一处：引擎里的 verify()',  # 短到 1280 宽不顶右边缘（预览量出来的）
        ]):
            d.text((tx, 348 + k * 46), line, font=fnt_small, fill=(242, 245, 251, 190))
    d.line([(tx, 320), (w - 60, 320)], fill=GRID_LINE, width=2)
    return img


# ---------------------------------------------------------------- 校验

def png_ihdr(path):
    with open(path, 'rb') as fh:
        head = fh.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', head[16:24])
    return w, h


# build() 写这 12 张，check() 按同一份清单核对盘上产物
ARTIFACTS = [
    'icons/icon-1024.png',
    'icons/icon-512.png',
    'icons/icon-192.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'icons/icon-180.png',
    'icons/icon-96.png',
    'icons/favicon-32.png',
    'icons/favicon-16.png',
    'assets/social/og-1280x640.png',
    'assets/textures/lattice-512.png',
    'assets/sprites/ripple-128.png',
]


def build():
    made = []
    master = icon_master(1024)  # 母图只算一次：逐像素渐变在纯 Python 里不便宜
    derived = derive(master, [512, 192, 180, 96, 32, 16])
    plan = [
        ('icons/icon-1024.png', master),
        ('icons/icon-512.png', derived[512]),
        ('icons/icon-192.png', derived[192]),
        ('icons/icon-maskable-512.png', icon_master(512, maskable=True)),
        ('icons/apple-touch-icon.png', derived[180]),
        ('icons/icon-180.png', derived[180]),
        ('icons/icon-96.png', derived[96]),
        ('icons/favicon-32.png', derived[32]),
        ('icons/favicon-16.png', derived[16]),
        ('assets/social/og-1280x640.png', og_card()),
        ('assets/textures/lattice-512.png', texture_lattice(512)),
        ('assets/sprites/ripple-128.png', sprite_ripple(128)),
    ]
    for rel, im in plan:
        dst = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, 'PNG', optimize=True)
        made.append((rel, os.path.getsize(dst)))
    if [rel for rel, _ in made] != ARTIFACTS:
        raise SystemExit('build() 的产物与 ARTIFACTS 清单脱钩了：%s' % ([r for r, _ in made],))
    return made


def check():
    ok = True
    for rel in ARTIFACTS:
        dst = os.path.join(ROOT, rel)
        if not os.path.exists(dst):
            print('MISSING %s' % rel)
            ok = False
            continue
        ihdr = png_ihdr(dst)
        if not ihdr:
            print('NOT_PNG %s' % rel)
            ok = False
            continue
        size = os.path.getsize(dst)
        if size == 0:
            print('EMPTY %s' % rel)
            ok = False
            continue
        print('OK %-34s %dx%d %d bytes' % (rel, ihdr[0], ihdr[1], size))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        sys.exit(0 if check() else 1)
    for rel, size in build():
        print('wrote %-34s %d bytes' % (rel, size))
    print('--- 复核 ---')
    sys.exit(0 if check() else 1)


if __name__ == '__main__':
    main()
