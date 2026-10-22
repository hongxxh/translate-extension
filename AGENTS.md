# 划词译 · SelectTrans 开发规则

Chrome MV3 划词翻译扩展。改代码前先读本文件的「代码结构」，不要重新通读源码。

## 边界约束

- 核心代码只在 `./src` 与 `manifest.json`。
- 测试文件（`test-*.js`、`tests/e2e/`）、`README.md`、`tools/` 可按需改动；`demo.html` / `panel-preview.html` 是静态预览，一般不必同步。
- 所有 API 必须符合 Manifest V3：service worker 无 DOM、无 `XMLHttpRequest`、无远程代码。

## 探索规则（省积分，务必遵守）

- **找东西先派 `code-explorer` subagent**：「某个函数在哪」「改动会影响哪些文件」「这段链路怎么走」这类问题，用 `task(subagent_name="code-explorer")` 去做，它的搜索过程不进主上下文，只回传结论。
- 派活要自包含：问题与用途 / 已知与已排除 / 目录范围 / `thoroughness`（quick·medium·very thorough）/「只回结论与证据路径，不要贴代码」。
- 只有确实要落笔时才自己读文件；**一次读够**，不反复读同一区域。
- 小任务（一两个已知文件的定点改动）直接做，不要为省事反而多派一轮。

## 代码结构（行号会漂移，按符号名搜索定位）

### `manifest.json`
MV3 v2.1.0。`permissions`: `storage`、`contextMenus`（无 `identity`）。`host_permissions`: 有道 / dictionaryapi.dev / freedictionaryapi.com / MyMemory / Azure / Google / DeepL（含 api-free）/ `http://*/*` + `https://*/*`（自定义模型与本地 Ollama 需要）。`background.service_worker` = `src/background.js`；`content_scripts` 注入 `src/content.js`（`document_idle`，非 all_frames）；`action.default_popup` = `src/popup.html`；`options_ui.page` = `src/options.html`（`open_in_tab`）。

### `src/background.js`（~935 行）— service worker
唯一有权调用远程 API 的上下文。
- 设置：`DEFAULT_SETTINGS:6`（字段见下）、`getSettings:82` / `setSettings:97`（对 `sources / compare / sentence` 与五个凭据组逐层深合并）
- 缓存：`CACHE_MAX:112`（300 条，按时间戳淘汰）、`cacheGet:114`、`cacheSet:126`；键 = `'ai:' + hashStr(provider|targetLang|kind|text)`，`runOnce:745`；仅缓存翻译结果，默认 7 天（`settings.cacheDays`）
- 词典聚合：`buildLinks:141`、`fetchYoudaoJSON:153`、`parseYoudao:160`、`fetchWiktionary:226`（dictionaryapi.dev）、`fetchFreeDictionary:262`（freedictionaryapi.com）、`fetchYoudaoSuggest:298`（有道简明）、`dictLookup:322`
- 语言判定：`textLooksZh:394`、`effectiveTargetLang:402`（**中文原文 + 中文目标 → 自动改译英语，所有通道共用**）；`buildPrompt:408` 走同一判定
- 文本处理：`cleanOutput:437`、`splitSentences:452`（认中英句末标点，用断言排掉 `3.14` / `e.g.`）、`mapLimit:480`、`splitChunks:697`
- 通道实现：`translateViaOpenAI:499`、`translateViaDeepl:541`、`translateViaAzure:579`、`translateViaGoogle:624`、`translateViaLibre:659`、`translateViaFreeMT:711`
- 分发与降级：`runProvider:733`（`chrome-ai` 直接抛 `CHROME_AI_PAGE_ONLY`，真身在 content.js）、`runOnce:745`（缓存 → 通道 → `free-mt` 兜底 → `cleanOutput` → 写缓存）、`aiTranslate:770`（句子/单词判定、句子专用通道、逐句对照）、`PARALLEL_ALLOWED:829`（`deepl/azure/google/openai/free-mt`）、`aiTranslateParallel:831`（并列对照强制 `fallback:false`）
- 消息路由 `chrome.runtime.onMessage:858`：`dict:lookup` / `settings:get` / `settings:set` / `ai:translate`（设置页连通性测试）/ `cache:clear` / `open:options`
- 长连接 `chrome.runtime.onConnect:894`：只接 `port.name === 'ai'`，`start` 后回推 `chan` / `partial` / `done` / `error`（content.js 侧 `startViaBackground:901`）
- 右键菜单：`onInstalled:921` 建 `st-lookup`，点击后向 tab 发 `{ type:'st:open', text }`

### `src/content.js`（~1240 行）— 划词交互层（IIFE）
- 宿主 id：`HOST_ID:11` = `st-root-host`（面板）、`st-root-host-tip`（气泡）；共用 `mountHost:201`（`attachShadow({mode:'open'})`）
- 定位：`clamp:249` / `apply:253` / `place:259`（面板）/ `placeTip:269`（气泡，贴选区末尾、右下优先、逐边翻转）
- 选区：`rectUsable:284` / `rangeRect:293`（**倒着找第一个有面积的 rect**，跨行选区末尾常是零宽的）/ `readSelection:310`
- 气泡：`showTip:353`（命中区 `TIP_BOX:12`=46px，`pointerdown` 触发）/ `hideTip:338` / `hideTipSoon:348` / `maybeShowTip:1092`
- 面板：`buildPanel:437`，渲染函数 `renderPhonetic:573` / `renderAiLoading:608` / `renderAiError:749` / `renderPairs:770`（逐句对照）/ `renderAiText:783` / `renderDictionary:808`（**词典 block 与双语例句都默认展开**：`det.open = true`）/ `renderLinks:879`
- 句子选项：`SENTENCE_MODES:649`、`sentenceMode:655`、`isSentenceText:661`、`effectiveProvider:667`（句子可单独指定通道，须与 background 判定一致）
- 翻译：`aiTargetLang:700`（本机模型的「中文原文 → 英语」判定，须与 background 的 `effectiveTargetLang` 一致）、`runChromeAi:708`（本机 Gemini Nano，只能在页面上下文）、`startViaBackground:901`、`startAi:943`（并列/单条分流，同步面板下拉）
- 事件：全部在 `boot:1203` 绑定（`mouseup` / `mousedown` / `keydown` / `selectionchange` / `scroll` / `resize` + `chrome.runtime.onMessage`）；`openOnce:1113` 防止 auto/alt 触发重复开面板
- 自动化就绪信号：`document.documentElement[data-st-ready=1]`（E2E 依赖它）

### `src/options.html` / `src/options.js`
11 节：1 通道 / 2 自定义模型 / 3 DeepL / 4 Azure / 5 Google / 6 LibreTranslate / 7 句子翻译 / 8 翻译行为 / 9 词典来源 / 10 连通性测试 / 11 使用要点。
`options.js`：`CARD_OF:46` + `applyProvider:55` 按所选通道显隐凭据卡片；`loadSettings:61` 回显；`bind:105` 里每个控件各自 `settings:set`；`runTest` 走 `ai:translate`；`DICT_SOURCES` 数组是词典开关的唯一清单。
DOM 契约（改 id 必须同步两边）：`provider`、`openaiCard/deeplCard/azureCard/googleCard/libreCard`、`azKey/azRegion`、`ggKey`、`lbBase/lbKey`、`sentProvider/sentMode/sentPerSentence/sentDict`、`src-youdao/collins/sentences/wiktionary/freedict/ydsimple`、`aiEnabled`、`testInput/runTest/testOut`。

### `src/popup.html` / `src/popup.js`
`provider` 下拉 7 项、目标语言、触发方式、并列对照、词典来源（6 项）、设置、清缓存。`popup.js`：`KEY_OF` 判断当前通道是否缺密钥 → `renderAuth` 显示状态点与提示；`DICT_SOURCES` 与 options.js 保持一致；消息 `settings:get` / `settings:set` / `cache:clear`。

### 设置结构 `DEFAULT_SETTINGS`（background.js:6）
顶层：`targetLang`、`trigger`、`aiEnabled`、`provider`、`fallbackEnabled`、`minLen`、`maxLen`、`cacheDays`
分组：`openai{baseUrl,apiKey,model}`、`deepl{apiKey}`、`azure{apiKey,region}`、`google{apiKey}`、`libre{baseUrl,apiKey}`、`sentence{provider,mode,perSentence,dict}`、`compare{enabled,providers}`（默认 `chrome-ai + deepl`）、`sources{youdao,collins,sentences,wiktionary,freedict,ydsimple}`

## 验证与完成标准（Definition of Done）

本项目**没有 package.json / npm run build**，等价步骤如下，改完必须全跑一遍：

```bash
cd /Users/xhxie/Downloads/resources/selecttrans
# 1) 语法校验（等价于构建检查）
for f in src/*.js tests/e2e/*.spec.mjs test-*.js; do node --check "$f" || exit 1; done

# 2) 通道契约测试：stub fetch，断言 URL/头/body，无需密钥，可进 CI
node test-providers.js

# 3) 解析冒烟：真实请求有道 / Wiktionary / MyMemory
node test-smoke.js

# 4) 端到端（真实 Chromium 加载扩展）
testkit run tests/e2e/selection-bubble.spec.mjs tests/e2e/pages.spec.mjs --extension=.
```

- 必须**贴出验证日志**，不允许凭感觉说"完成了"。
- **同步结构图**：只要改了下面这些"接口"，就在同一个 PR/同一次改动里更新本文档的「代码结构」与行号——地图过期比没有地图更糟：
  - `chrome.runtime` 消息类型、`onConnect` 端口名与回推事件名（`chan`/`partial`/`done`/`error`）
  - `DEFAULT_SETTINGS` 字段（含 `sentence` / `compare` / `sources` 子结构）
  - 翻译通道的增删（`PROVIDERS`、`PARALLEL_ALLOWED`、`translateVia*`）
  - Shadow DOM 宿主 id（`st-root-host` / `st-root-host-tip`）与面板 CSS 类名
  - options.html / popup.html 里被 JS `$()` 取用的 DOM id
  - testkit 相关契约（如 `data-st-ready` 就绪标记）
- `selection-bubble.spec.mjs` 守着三个历史 bug：贴顶选区气泡被顶出视口（负 top）、跨行选区末尾零宽 rect、气泡命中区太小点不中；外加句子显示方式开关。改 `content.js` 的定位/选区逻辑后这个 spec 必须过。
- `pages.spec.mjs` 守着设置页与弹窗的 DOM 契约（改 id 不同步就会 JS 报错）。

## 测试环境（机器级，不要在项目中重复安装）

- 工具包在 `~/dev/playwright-testkit`，全局命令 `testkit`；**不要**给本项目加 playwright/puppeteer 依赖。
- spec 是普通 ESM：`export default async function (t) {}`，`t` 提供 `launch / getExtensionId / serve / captureConsole / expect / waitFor / options / log`。
- 品牌版 Google Chrome 忽略 `--load-extension`，扩展测试必须用 Playwright 自带 Chromium；带 `--extension` 时 testkit 会自动切 `channel=chromium`。
- **坑**：CLI 的 `--extension` 只写进 `t.options.extensions`，`launch()` 不会自动带上，spec 里必须显式 `launch({ extensions: options.extensions })`，否则 extensionIds 为空、content script 不注入。
- **坑**：content script 与页面 JS 隔离，`page.evaluate` 读不到 content script 挂在 `window` 上的变量；用共享 DOM 做标记（`data-st-ready`）。
- 扩展 ID 由扩展目录绝对路径推导，移动目录会变。

## 打包

```bash
mkdir -p dist && zip -r -q -X dist/selecttrans-<version>.zip manifest.json src -x '*.DS_Store' '*__MACOSX*'
```

`manifest.json` 必须在压缩包根目录。验证方式：解压到临时目录，用 `--extension=<解压目录>` 跑一遍上面的 E2E。

## 已知边界（改代码前先扫一眼）

- 七个通道：`chrome-ai`（页面上下文）/ `deepl` / `azure` / `google` / `libre` / `openai` / `free-mt`。并列对照只允许远程通道（`PARALLEL_ALLOWED` 含 `libre`），且**不做 free-mt 兜底**，否则两列会显示同一结果。
- `chrome-ai` 只能在 content.js 调用；background 收到就抛 `CHROME_AI_PAGE_ONLY`。
- 「原文已是中文时自动改译英语」必须在分发前统一算目标语言（background `effectiveTargetLang` / content `aiTargetLang`）；只在 prompt 里翻转会让机器翻译通道照旧译成中文、甚至报 `FREE_MT_SAME_LANG`。
- 句子默认不查词典；句子可单独指定通道；并列模式下不产生逐句对照对（`noPairs`）。
- 有道 `jsonapi` / 有道 `suggest`、freedictionaryapi.com、MyMemory 均为非官方/有限额接口，失效时要能安全降级。
- 词典区块（柯林斯、词形、英英、双语例句）一律默认展开，`block.collapsed` 只表示「可折叠」，不再表示「初始收起」。
- 已下线、不要再接：腾讯混元 HY-MT2（`tencent` 通道整条移除）、腾讯翻译君 `fanyi.qq.com`、腾讯云 TMT `TextTranslate`、必应词典 HTML 抓取、WorkBuddy Open API。
