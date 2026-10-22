# -*- coding: utf-8 -*-
"""
SelectTrans 图标生成器  v1.4.0

规格（用户要求）：
  1. LOGO 主色 = 天青色
  2. 重影式重叠（白色重影左上 + 深墨重影右下）
  3. 水平 180°（横转 / 镜像）
  4. 字体 = Snell Roundhand（铜板体 / 圆体花体，与参考图一致）
  5. 底板 = 亮绿色渐变（沿用上一轮）

字体：/System/Library/Fonts/Supplemental/SnellRoundhand.ttc
      index 0=Regular  1=Bold  2=Black

尺寸策略：
  大尺寸用细笔画显优雅；小尺寸逐级加粗（像素级偏移伪加粗）并加大留白，
  保证 16px 在工具栏里仍读得出 S 的「上碗—斜干—下碗」结构。
  重影偏移量随尺寸递增，16px 只保留 1px 深墨重影以免被圆角切掉。
"""
from PIL import Image, ImageDraw, ImageFont, ImageOps

SN  = '/System/Library/Fonts/Supplemental/SnellRoundhand.ttc'
OUT = '/Users/xhxie/WorkBuddy/2026-10-21-09-49-56/selecttrans/src/icons'
SS  = 14                                   # 超采样倍率

# ---------------- 配色 ----------------
PLATE_T, PLATE_B = ( 61, 255, 158), (  0, 200,  83)   # 亮绿底板  #3DFF9E → #00C853
AZ_T,    AZ_B    = (184, 231, 250), ( 98, 196, 232)   # 天青 S    #B8E7FA → #62C4E8
INK              = (  6,  32,  62)                    # 深墨重影  #06203E
WHT              = (255, 255, 255)                    # 白色重影


def vgrad(w, h, top, bot):
    """竖向渐变"""
    g = Image.new('RGB', (1, h))
    px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    return g.resize((w, h), Image.NEAREST)


def round_mask(size, r):
    """圆角方形蒙版（4 倍超采样避免锯齿）"""
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1],
                                        radius=r * 4, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def glyph_mask(size, hf, wf, idx, bold):
    """超采样渲染 → 包围盒裁剪 → 双约束装箱 → 水平 180° 镜像"""
    K = size * SS
    f = ImageFont.truetype(SN, K, index=idx)
    c = Image.new('L', (K * 3, K * 3), 0)
    d = ImageDraw.Draw(c)
    d.text((K, K), 'S', font=f, fill=255)
    for ox in range(-bold, bold + 1):           # 伪加粗：像素级偏移叠加
        for oy in range(-bold, bold + 1):
            d.text((K + ox * 2, K + oy * 2), 'S', font=f, fill=255)
    c = c.crop(c.getbbox())
    w, h = c.size
    # 双约束：Snell Roundhand 的 S 宽高比约 1.19，只按高度装箱会横向顶满画布
    th = max(1, int(round(size * hf)))
    tw = max(1, int(round(w * th / h)))
    cap = int(round(size * wf))
    if tw > cap:
        tw, th = cap, max(1, int(round(h * cap / w)))
    c = c.resize((tw * 2, th * 2), Image.LANCZOS)   # 两级降采样保留抗锯齿
    c = c.resize((tw, th), Image.LANCZOS)
    return ImageOps.mirror(c)                        # 水平 180° 横转


def tint(mask, top, bot):
    """把 L 掩膜按竖向渐变着色成 RGBA 图层"""
    w, h = mask.size
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    layer.paste(vgrad(w, h, top, bot), (0, 0), mask)
    return layer


def onto(canvas, layer, x, y, alpha=1.0):
    if alpha < 1.0:
        layer = layer.copy()
        layer.putalpha(layer.getchannel('A').point(lambda v: int(v * alpha)))
    canvas.alpha_composite(layer, (x, y))


def build(size, hf, wf, idx, bold, off, white):
    S = size
    cv = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    plate = vgrad(S, S, PLATE_T, PLATE_B).convert('RGBA')
    plate.putalpha(round_mask(S, S * 0.235))
    cv.alpha_composite(plate, (0, 0))

    g = glyph_mask(S, hf, wf, idx, bold)
    gw, gh = g.size
    ox, oy = (S - gw) // 2, (S - gh) // 2

    # 重影式重叠：白色重影偏左上，深墨重影偏右下，主体压在最上层
    if white:
        onto(cv, tint(g, WHT, WHT), ox - off, oy - off, 0.50)
    onto(cv, tint(g, INK, INK), ox + off, oy + off, 0.95)
    onto(cv, tint(g, AZ_T, AZ_B), ox, oy)
    return cv


#  (尺寸, 高占比, 宽上限, 字重index, 伪加粗, 重影偏移, 是否白色重影)
PLAN = [
    (128, 0.60, 0.80, 1, 0, 4, True ),
    ( 48, 0.63, 0.82, 1, 0, 2, True ),
    ( 32, 0.66, 0.84, 1, 1, 2, True ),
    ( 16, 0.72, 0.88, 2, 2, 1, False),
]


def main():
    ims = []
    for size, hf, wf, idx, bold, off, white in PLAN:
        im = build(size, hf, wf, idx, bold, off, white)
        im.save('%s/icon%d.png' % (OUT, size))
        ims.append(im)
        print('icon%-4d 字形 %2dx%-2d  重影偏移 %dpx  白重影 %s'
              % (size, *glyph_mask(size, hf, wf, idx, bold).size, off, '有' if white else '无'))

    # 对照图：四尺寸并排 + 小尺寸放大
    w = 128 + 48 + 32 + 16 + 50
    sheet = Image.new('RGBA', (w, 148), (32, 36, 43, 255))
    x = 12
    for s, im in zip((128, 48, 32, 16), ims):
        sheet.alpha_composite(im, (x, 10))
        x += s + 12
    sheet.convert('RGB').save('/tmp/icons-v140.png')

    z = Image.new('RGB', (128 * 2 + 128 + 20, 128), (32, 36, 43))
    z.paste(ims[3].convert('RGB').resize((128, 128), Image.NEAREST), (0, 0))
    z.paste(ims[2].convert('RGB').resize((128, 128), Image.NEAREST), (138, 0))
    z.paste(ims[1].convert('RGB').resize((128, 128), Image.NEAREST), (276, 0))
    z.save('/tmp/icons-v140-zoom.png')
    print('预览已生成')


if __name__ == '__main__':
    main()
