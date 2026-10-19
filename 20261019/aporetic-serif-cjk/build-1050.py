#!/usr/bin/env python3
"""把朱雀仿宋的全角字形宽度改成 1050，使其与 Aporetic Serif Mono 的 2 格（2 × 525）严格对齐。

用法:
    python build-1050.py fonts/ZhuqueFangsong-Regular.ttf fonts/ZhuqueFangsong-Aporetic1050.ttf

原理:
    汉字 advance 恒为 1000/1000 em，而 Aporetic 单字 525 -> 2 格 = 1050。
    逐个全角字形：advance 1000 -> 1050，轮廓右移 25 单位保持居中（字形本身不缩放，
    视觉密度不变，只是字距略松 5%）。拉丁与半角标点原样保留。
"""
import sys
import time

from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

BASE = 1000
TARGET = 1050           # 2 × Aporetic 的 525
SHIFT = (TARGET - BASE) // 2


def convert(src: str, dst: str, family: str = "Zhuque Fangsong A1050") -> int:
    t0 = time.time()
    font = TTFont(src)
    hmtx, glyf = font["hmtx"], font["glyf"]
    glyphset = font.getGlyphSet()

    changed = 0
    for gname in font.getGlyphOrder():
        advance, lsb = hmtx[gname]
        if advance != BASE:          # 只动全角（CJK 汉字、全角标点、U+3000）
            continue
        pen = TTGlyphPen(glyphset)   # 传入 glyphSet 以便保留合体字形引用
        glyphset[gname].draw(TransformPen(pen, (1, 0, 0, 1, SHIFT, 0)))
        glyf[gname] = pen.glyph()
        hmtx[gname] = (TARGET, lsb + SHIFT)
        changed += 1

    # 改 family 名，避免与原版朱雀在字体菜单里冲突
    name = font["name"]
    ps = family.replace(" ", "") + "-Regular"
    for rec in list(name.names):
        if rec.nameID in (1, 4, 16, 18):
            rec.string = family
        elif rec.nameID in (3, 6):
            rec.string = ps + ";v0.212"

    font.save(dst)
    print(f"{changed} 个全角字形 {BASE} -> {TARGET}, {time.time() - t0:.1f}s -> {dst}")
    return changed


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
