# 划词译 · SelectTrans

Chrome 划词翻译扩展（Manifest V3）

## 功能

**划词 → 气泡「译」按钮 → 面板**，面板内同时呈现：

| 区块 | 来源 | 说明 |
|---|---|---|
| 翻译 | 七条通道可选，支持多通道并列对照（见下） | 支持单词与句子两种模板，主通道失败自动降级 |
| 有道词典 · 英汉双解 | `dict.youdao.com/jsonapi` | 音标（英/美）、词性释义、词形变化 |
| 柯林斯高阶词典 | 有道聚合 | 带星级（★）、英文释义 + 双语例句 |
| 双语例句 | 有道聚合 | 权威对齐例句 |
| Wiktionary 英英释义 | `api.dictionaryapi.dev` | 开放 API，含真人发音音频 |
| Free Dictionary · 英英释义 | `freedictionaryapi.com` | 免密钥、Wiktionary 数据，含音标与例句 |
| 有道 · 简明释义 | `dict.youdao.com/suggest` | 中文简明释义速览 |
| 官网跳转 | Cambridge / Merriam-Webster / Collins / 有道 | 权威原文一键直达 |

展示顺序：有道 → 柯林斯 → 词形变化 → 英英释义 → Free Dictionary → 简明释义。词典区块默认全部展开，点标题可收起。

其余：结果本地缓存 7 天、右键菜单查询、触发方式可配置（气泡 / 自动 / Alt 划词）、发音播放、**AI 区块标题就是通道入口，面板内可直接切换并立即重译**（旁边还有「单条 / 对照」形态开关，句子模式下再多一个「译文 / 对照 / 原文」开关）。

## 七条翻译通道

不想注册任何账号时，直接用 **Chrome 内置 AI** 或 **免费机器翻译**，两者完全不需要注册。

| 通道 | 需要认证吗 | 特点 |
|---|---|---|
| **Chrome 内置 AI**（默认） | **完全不需要** | Gemini Nano 跑在本机，零配置零密钥、离线可用、文本不出设备；需 Chrome 138+ 且硬件达标。端侧小模型，**长句质量有限** |
| **DeepL** | 免费档需邮箱注册 | **欧洲语言与长句质量最好**。Free 档 50 万字符/月，Key 以 `:fx` 结尾自动走 `api-free.deepl.com` |
| **Microsoft Translator（Azure）** | 需 Azure 订阅密钥 + 区域 | 必应翻译的官方继任者，110+ 语言、自动检测语种；F0 档每月 200 万字符 |
| **Google Cloud Translation** | 需 Google Cloud API Key | v2 Basic `?key=` 直连，前 50 万字符/月免费；多语种覆盖最广 |
| **LibreTranslate** | 自建通常不需要 | 开源后端，可 `docker run libretranslate/libretranslate` 自建，数据自己掌握；官方公共服务需注册 Key |
| **自定义模型（OpenAI 兼容）** | 取决于供应商 | 任何 `/chat/completions` 接口：DeepSeek / 智谱 / Moonshot / 通义 / 本地 Ollama。本地 Ollama 零注册 |
| **免费机器翻译** | 不需要 | MyMemory 公开接口，匿名可用，质量一般；同时作为全局降级兜底 |

**选长句通道的建议**：中→英或多语种、欧洲语言优先 **DeepL**；需要术语表/风格控制走 **自定义模型**；完全离线用 Chrome 内置 AI。

### 多通道并列对照

一个通道的译文好不好，往往没有客观答案 —— 所以面板可以直接把多个通道的结果并排放出来比。

默认开启 **本地模型 ＋ DeepL** 两列。本地模型排第一是有意的：它零配置、零密钥、离线可用，永远是手上那张保底牌，不该因为开了对照就看不见。其余远程通道（含 LibreTranslate）都能勾进并排。

配置在**设置页第 1 节「并列对照」**里直接勾选通道，勾几个就并排几列（至少两个才生效）。

实现要点：

- 面板宽度按列数算：`32 + n × 252 + (n-1) × 14`，两列 550px、三列 816px；`max-width: calc(100vw - 16px)` 兜窄屏。
- 各通道**并发请求**，各自流式回填到自己的列，一条失败不影响另一条。事件带 `provider` 名字，UI 按名字找列而不是按数组下标，避免任一侧过滤顺序不同导致错位。
- **本地模型走单独的路径**：它只能在页面上下文调用，由 `startAi` 用 `runChromeAi` 直接跑；其余通道打包成数组交给 background 的 port。所以本地那列不会被 service worker 的 `CHROME_AI_PAGE_ONLY` 卡住。
- **不做免费机器翻译兜底**。单通道模式下失败会自动降级到 MyMemory，但并列模式下那样做会让多列显示同一个结果，对照就失去意义 —— 所以宁可让那一列明确报错（"未填写 DeepL 的 Auth Key"），用户才知道该去补哪个密钥。
- 面板标题栏的「单条 / 对照」按钮可随时切换形态，写进配置，下次划词沿用。

### 关于「中文原文自动改译英语」

目标语言是中文时，选中中文会改译为英语 —— 这条规则在 `aiTranslate` 分发前统一算一次生效目标语言（background 的 `effectiveTargetLang`），DeepL / Azure / Google / LibreTranslate / MyMemory 与本机模型（content.js 的 `aiTargetLang`）都吃同一个结果。只在提示词里翻转是无效的：机器翻译通道读的是语言码，会把中文再译成中文，甚至直接报「原文与目标语言相同」。

### 已下线

腾讯翻译君 `fanyi.qq.com`（2025-04-15 关闭）、腾讯云 TMT `TextTranslate`、腾讯混元 HY-MT2 通道均已移除；`tencent` 不再出现在通道表里，旧配置里的凭据会被忽略。

句子与单词使用不同提示词模板：`aiTranslate` 里按「≤3 个词且 ≤40 字符」判定为单词，走词典式三行输出；否则走纯译文模板，并要求保留段落结构与标点风格。

Chrome 内置 AI 在**页面上下文（content script）**里调用 —— Web Worker / service worker 中不可用。检测到不支持时会自动走降级链。

硬件门槛（Chrome 官方）：Win10/11、macOS 13+、Linux 或 Chromebook Plus；GPU 显存 >4GB，或 16GB 内存 + 4 核；Chrome profile 所在磁盘 ≥22GB 可用。可在 `chrome://on-device-internals` 查看本机状态。

## 句子翻译选项

句子和单词的诉求不同：单词要释义，句子要通顺。设置页第 7 节给了四个独立选项，面板标题栏上也能当场切换显示方式。

| 选项 | 取值 | 说明 |
|---|---|---|
| 专用通道 | `follow` / 任意通道 | 句子可以走和单词不同的通道。例如单词用本地模型看释义，长句交给 DeepL |
| 显示方式 | 只显示译文 / **逐句双语对照** / 先原文后译文 | 「对照」会按句拆开、一句一句翻，再原文译文配对显示 |
| 按句拆分 | 开（默认） | 整段切成句子分别请求：对照更整齐、更容易命中缓存；关掉则整段一次请求，更快 |
| 也查词典 | 关（默认） | 词典查不到整句，默认跳过这次往返 |

切句规则按中英句末标点（`。！？；…!?;`）与换行，标点保留在原句上；超过 24 句退回整段翻译，避免一次撒出太多请求。逐句请求并发上限 4。

## 安装（开发者模式）

1. 打开 `chrome://extensions` → 右上角开启「开发者模式」
2. 点「加载已解压的扩展程序」→ 选择本目录（`selecttrans/`）
3. 固定到工具栏即可使用；词典功能开箱即用，无需任何配置

## 文件结构

```
selecttrans/
├── manifest.json          # MV3 清单
├── src/
│   ├── background.js      # 设置与密钥管理 / 词典聚合 / 多通道翻译 / 缓存
│   ├── content.js         # 划词检测、气泡、Shadow DOM 面板
│   ├── popup.html / popup.js
│   ├── options.html / options.js
│   └── icons/
├── tools/
│   └── gen-icons.py       # 图标生成器（改配色/字体后一条命令重出四尺寸）
├── tests/e2e/             # 端到端冒烟（用全局 testkit 跑，无需在本项目装 playwright）
├── demo.html              # 面板效果预览（真实数据静态渲染）
├── test-smoke.js          # 词典解析冒烟测试（node test-smoke.js）
└── test-providers.js      # 通道契约测试（node test-providers.js，无需密钥）
```

## LOGO

重出图标：

```bash
python3 tools/gen-icons.py
```

需要 Pillow：`pip install Pillow`。Snell Roundhand 仅在 macOS 上可用，其他平台需自备同款字体并改脚本里的 `SN` 路径。

## 已知边界

- **Chrome 内置 AI 中文质量有限**：Gemini Nano 是端侧小模型，英→中可用于快速理解，长句和专业术语建议切到自定义模型。语言对不受支持时 `Translator.availability()` 会返回 `unavailable`，代码自动跳过。
- **自定义模型通道需要 `http://*/*` 与 `https://*/*` 主机权限**：因为接口地址由用户填写（含本地 Ollama），无法预先收敛域名。安装时 Chrome 会给出"读取和更改所有网站数据"的提示，这是该设计的必然代价。
- **免费机器翻译有匿名配额**：MyMemory 匿名约每日 5000 词，超出会失败并回退报错；仅作兜底。
- **DeepL Free 有月度配额**：免费档 50 万字符/月，超出返回 456；单次请求上限 128KiB（代码按 4000 字符切段，远低于上限）。DeepL 中文仅支持简体，繁体目标也会译成简体。
- **句子面板默认不查词典**：划选内容判定为句子（≥20 字符或 ≥5 个词）时跳过词典请求，面板只显示翻译；原文默认折叠为一行，点击展开。需要的话可在设置页第 7 节打开。
- **密钥保存在本机**：扩展是纯客户端形态，各通道的密钥都存于 `chrome.storage.local`，不会上传到任何服务器。个人使用可接受；团队分发建议自建后端中转持有密钥。
- **AI 部分需凭据才能端到端验证**：词典解析、面板 UI、缓存、降级逻辑均已冒烟测试；各通道的请求/响应严格按官方文档实现，但无密钥时无法实测，首次使用请先用设置页「连通性测试」。
- **Google 翻译走 v2 Basic**：`?key=` 直连，不需要 OAuth；代价是 API Key 会出现在请求 URL 里（本机发出，不外传）。v3 需要服务账号 JWT，不适合纯客户端扩展。
- **LibreTranslate 的源语言是启发式的**：匿名实例通常关闭了 `auto` 检测，代码按「含中日韩文字 → zh，否则 en」给源语言。混合语种长文可能误判，自建实例可自行调整。
- 有道 `jsonapi` / 有道 `suggest`、`freedictionaryapi.com`、`dictionaryapi.dev` 均为免密钥公开接口，实测可用但无 SLA；任一路失效只会少一块释义，其余来源与跳转链接照常显示。
- Cambridge 官网返回 520（Cloudflare 拦截脚本抓取），因此以官网跳转方式提供，不做页面抓取。
- **天青与亮绿亮度接近，LOGO 靠重影提供对比**：天青 `#B8E7FA`（亮度约 228）与亮绿底板 `#3DFF9E`（约 186）的亮度只差 40 左右，单靠颜色分不开。当前方案是让深墨重影（亮度约 30）承担边缘对比 —— 这也是「重影式重叠」本身的效果。若想让 S 自身更跳，把底板压暗（如 `#22C55E → #05803A`）即可，生成器里改 `PLATE_T/PLATE_B` 两个常量。

## 测试

```bash
node test-smoke.js       # 词典解析、聚合、通道分发（会真实请求有道/Wiktionary/Free Dictionary/MyMemory）
node test-providers.js   # 通道契约：stub fetch 断言 URL/头/body，无需密钥，可进 CI

# 端到端：真实 Chromium 加载未打包扩展，验证划词气泡与面板
testkit run tests/e2e/selection-bubble.spec.mjs --extension=.
```
