#!/usr/bin/env python3
"""给单字重的朱雀仿宋合成一款 Bold（轮廓外扩，非伪粗体）。

    python -m pip install skia-pathops
    python build-bold.py fonts/ZhuqueFangsong-Regular.ttf fonts/ZhuqueFangsong-Bold.ttf 30

原理:
    strength=30 表示每个字形沿轮廓外扩 30 单位（仿宋竖画 54 -> 84/1000，
    介于思源宋体 400 的 68 与 Bold 的 100 之间；再大就会糊掉警/鼻这类密字）。用 pathops 把「原轮廓 ∪ 描边(S)」求并，
    得到真正的粗轮廓，而不是渲染器那种横向挤出来的合成粗体。

产出的字体沿用原 family 名，subfamily = Bold、OS/2 权重 700，
系统/编辑器会在需要粗体时自动选中它。
"""
import sys

import pathops
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont


def outline_to_path(glyphset, gname):
    rec = DecomposingRecordingPen(glyphset)
    glyphset[gname].draw(rec)
    path = pathops.Path()
    rec.replay(path.getPen())
    return path


def embolden(path, strength):
    """原轮廓 ∪ 描边(S) —— pathops 的 stroke() 是就地修改，必须先复制一份。"""
    stroke = pathops.Path()
    stroke.addPath(path)
    stroke.stroke(strength, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 2)
    return pathops.op(path, stroke, pathops.PathOp.UNION)


def build(src: str, dst: str, strength: int = 40, family_suffix: str = "") -> None:
    font = TTFont(src)
    glyf, hmtx = font["glyf"], font["hmtx"]
    glyphset = font.getGlyphSet()
    order = font.getGlyphOrder()

    errors = 0
    for i, gname in enumerate(order):
        advance, lsb = hmtx[gname]
        if advance == 0:                      # 空白字形跳过
            continue
        try:
            path = outline_to_path(glyphset, gname)
            if not path.contours:
                continue
            bold = embolden(path, strength)
            pen = TTGlyphPen(None)
            bold.draw(pen)
            glyf[gname] = pen.glyph()
            hmtx[gname] = (advance, lsb)
        except Exception as exc:               # 保底：出问题就留原字形
            errors += 1
            if errors <= 5:
                print(f"  ! {gname}: {exc}")
        if i % 2000 == 0:
            print(f"  {i}/{len(order)}", flush=True)

    # 声明成同一 family 的 Bold
    name = font["name"]
    base_family = name.getDebugName(1)
    if family_suffix:
        base_family = base_family + family_suffix
    for rec in list(name.names):
        if rec.nameID == 1:
            rec.string = base_family
        elif rec.nameID == 2:
            rec.string = "Bold"
        elif rec.nameID == 4:
            rec.string = f"{base_family} Bold"
        elif rec.nameID == 6:
            rec.string = base_family.replace(" ", "") + "-Bold"
        elif rec.nameID == 16:
            rec.string = base_family
        elif rec.nameID == 17:
            rec.string = "Bold"

    os2, head = font["OS/2"], font["head"]
    os2.usWeightClass = 700
    os2.fsSelection = (os2.fsSelection & ~0x40) | 0x20   # BOLD, 去掉 REGULAR
    head.macStyle |= 1                                   # bold bit

    font.save(dst)
    print(f"saved {dst} (strength={strength}, errors={errors})")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 40)
