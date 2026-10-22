#!/usr/bin/env python3
"""从 src/content.js 抽出面板 CSS，生成 panel-preview.html。

样式与线上同源：改 content.js 的 CSS 后重跑本脚本即可，避免预览页与实际脱节。
用法：python3 tools/gen-preview.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / "src" / "content.js").read_text(encoding="utf-8")

m = re.search(r"const CSS = `(.*?)`;", src, re.S)
if not m:
    raise SystemExit("没找到 const CSS 模板字符串")
css = m.group(1)
# :host 只在 shadow root 里有效，预览页直接去掉这一条
css = re.sub(r":host\s*\{[^}]*\}\n?", "", css)

WORD_CARD = """
<div class="st-card">
  <div class="st-hd">
    <div class="st-title"><span class="st-word">defer</span></div>
    <button class="st-close">&#10005;</button>
  </div>
  <div class="st-phon">
    <span class="st-p">英 /dɪˈfɜː(r)/ &#9834;</span>
    <span class="st-p">美 /dɪˈfɜːr/ &#9834;</span>
  </div>
  <div class="st-body">
    <section class="st-sec">
      <div class="st-sec-hd">
        <span class="st-badge">AI</span>
        <select class="st-ch"><option>腾讯混元 · hy-mt2-pro</option></select>
        <button class="st-cmp">对照</button>
        <span class="st-mode"></span>
      </div>
      <div class="st-ai-body">
        <div class="st-ai-text"><div class="st-ai-line1">推迟</div><div>v. 推迟，延期；服从（他人的意愿）</div><div>They deferred the vote until next week. 他们把表决推迟到下周。</div></div>
      </div>
    </section>
    <section class="st-sec">
      <div class="st-src">
        <div class="st-src-hd"><span class="st-src-n">有道 · 英汉双解</span></div>
        <div class="st-ai-text" style="color:#4B5563">vt. 使推迟；使延期；服从</div>
      </div>
    </section>
  </div>
  <div class="st-ft"></div>
</div>
"""

SENT_SINGLE = """
<div class="st-card">
  <div class="st-hd">
    <div class="st-title"><span class="st-word is-sent">The committee deferred its decision pending further evidence.</span></div>
    <button class="st-close">&#10005;</button>
  </div>
  <div class="st-phon"></div>
  <div class="st-body">
    <section class="st-sec">
      <div class="st-sec-hd">
        <span class="st-badge">AI</span>
        <select class="st-ch"><option>DeepL</option></select>
        <button class="st-cmp">对照</button>
        <span class="st-mode">缓存</span>
      </div>
      <div class="st-ai-body">
        <div class="st-ai-text">委员会推迟了决定，等待进一步的证据。</div>
      </div>
    </section>
  </div>
  <div class="st-ft"></div>
</div>
"""

def cmp_width(n):
    """与 content.js 的 cmpWidth() 保持一致"""
    return min(32 + n * 252 + (n - 1) * 14, 980)


SENT_PARALLEL = """
<div class="st-card is-cmp" style="width:%dpx">
  <div class="st-hd">
    <div class="st-title"><span class="st-word is-sent">The committee deferred its decision pending further evidence.</span></div>
    <button class="st-close">&#10005;</button>
  </div>
  <div class="st-phon"></div>
  <div class="st-body">
    <section class="st-sec">
      <div class="st-sec-hd">
        <span class="st-badge">AI</span>
        <span class="st-cmp-tag">并列 3</span>
        <button class="st-cmp">单条</button>
        <span class="st-mode"></span>
      </div>
      <div class="st-ai-body">
        <div class="st-ai-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div class="st-col">
            <div class="st-col-hd"><b>本地模型 · Gemini Nano</b><span class="st-col-tag">本机</span></div>
            <div class="st-ai-body"><div class="st-ai-text">委员会推迟了决定，等待进一步的证据。</div></div>
          </div>
          <div class="st-col">
            <div class="st-col-hd"><b>腾讯混元翻译</b><span class="st-col-tag"></span></div>
            <div class="st-ai-body"><div class="st-ai-text">委员会推迟决定，等待进一步证据。</div></div>
          </div>
          <div class="st-col">
            <div class="st-col-hd"><b>DeepL</b><span class="st-col-tag">缓存</span></div>
            <div class="st-ai-body"><div class="st-ai-text">该委员会暂缓作出决定，以等待进一步的证据。</div></div>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div class="st-ft"></div>
</div>
""" % cmp_width(3)

PARALLEL_ERR = """
<div class="st-card is-cmp" style="width:%dpx">
  <div class="st-hd">
    <div class="st-title"><span class="st-word is-sent">Privacy is not something that I'm merely entitled to, it's an absolute prerequisite.</span></div>
    <button class="st-close">&#10005;</button>
  </div>
  <div class="st-phon"></div>
  <div class="st-body">
    <section class="st-sec">
      <div class="st-sec-hd">
        <span class="st-badge">AI</span>
        <span class="st-cmp-tag">并列 2</span>
        <button class="st-cmp">单条</button>
        <span class="st-mode"></span>
      </div>
      <div class="st-ai-body">
        <div class="st-ai-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="st-col">
            <div class="st-col-hd"><b>腾讯混元翻译</b><span class="st-col-tag"></span></div>
            <div class="st-ai-body"><div class="st-ai-text">隐私不是我所仅仅有权享有的东西，它是绝对的前提。</div></div>
          </div>
          <div class="st-col">
            <div class="st-col-hd"><b>DeepL</b><span class="st-col-tag">失败</span></div>
            <div class="st-ai-body">
              <div class="st-ai-err"><b>翻译失败：</b>未填写 DeepL 的 Auth Key（设置页第 5 节）</div>
              <button class="st-act">打开设置并授权</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div class="st-ft"></div>
</div>
""" % cmp_width(2)

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>划词译 · 面板形态预览</title>
<style>
  html, body {{ margin: 0; padding: 0; background: #F6F7F9; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #1F2329; padding: 30px 28px 60px;
  }}
  .wrap {{ max-width: 1040px; margin: 0 auto; }}
  h1 {{ font-size: 17px; font-weight: 600; margin: 0 0 4px; }}
  .sub {{ font-size: 12.5px; color: #8A919D; margin-bottom: 26px; }}
  .demo {{ margin-bottom: 30px; }}
  .demo-hd {{ font-size: 12px; font-weight: 600; color: #6B7280; letter-spacing: .02em; margin-bottom: 9px; }}
  .demo-note {{ font-size: 12px; color: #8A919D; margin-top: 9px; max-width: 700px; line-height: 1.7; }}
  .st-host {{ display: inline-block; }}
  .st-card {{ box-shadow: 0 4px 16px rgba(15,23,42,.08), 0 1px 3px rgba(15,23,42,.05); }}
  .st-card .st-close {{ cursor: default; }}
  .st-card .st-ch {{ appearance: none; }}
</style>
<style>
{css}
</style>
</head>
<body>
<div class="wrap">
  <h1>划词译 · 面板形态预览</h1>
  <div class="sub">样式直接取自 src/content.js 的 CSS 模板，与扩展里完全同源。这里是静态快照，交互不生效。</div>

  <div class="demo">
    <div class="demo-hd">单词 · 单通道</div>
    <div class="st-host">{WORD_CARD}</div>
    <div class="demo-note">单词走词典式三行输出（首行译文加粗，其后词性释义与例句），标题栏右侧是「对照」按钮。</div>
  </div>

  <div class="demo">
    <div class="demo-hd">句子 · 单通道</div>
    <div class="st-host">{SENT_SINGLE}</div>
    <div class="demo-note">句子原文只占一行，点击展开。句子不查词典，省一次网络往返。</div>
  </div>

  <div class="demo">
    <div class="demo-hd">句子 · 并列 3 列（本地模型 + 腾讯混元 + DeepL）</div>
    <div class="st-host">{SENT_PARALLEL}</div>
    <div class="demo-note">默认就是这三列：本地模型排第一，零配置离线可用，永远是保底那张牌；后面跟两个云端通道。面板宽度按列数算（每列 252px），三列 816px，窄屏会收缩到视口宽度。标题栏的「单条」可以随时切回上一种形态。</div>
  </div>

  <div class="demo">
    <div class="demo-hd">并列 2 列 · 一侧缺密钥</div>
    <div class="st-host">{PARALLEL_ERR}</div>
    <div class="demo-note">并列模式不做免费机器翻译兜底：哪一列缺密钥就直接报错，免得两列显示同一个结果、看不出差别。想勾哪几列，在设置页第 1 节「并列对照」里打勾。</div>
  </div>
</div>
</body>
</html>
"""

out = ROOT / "panel-preview.html"
out.write_text(html, encoding="utf-8")
print("wrote", out, len(html), "bytes")
