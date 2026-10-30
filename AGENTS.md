# 划词译 · SelectTrans 开发规则

Chrome MV3 划词翻译扩展，**源码是 TypeScript，用 esbuild 打包到 `dist/`**。改代码前先读本文件的「代码结构」，不要重新通读源码。

## 边界约束

- 核心代码只在 `./src`；`manifest.json` 也在 `src/`（路径相对构建产物 `dist/` 根目录）。
- 浏览器实际加载的是 `dist/`，**不是 `src/`**：改完源码必须 `npm run build`。
- 测试文件（`test-*.js`、`tests/e2e/`）、`README.md`、`tools/` 可按需改动；`demo.html` / `panel-preview.html` 是静态预览（后者由 `tools/gen-preview.py` 从 `src/content/ui/styles.css` 生成）。
- 所有 API 必须符合 Manifest V3：service worker 无 DOM、无 `XMLHttpRequest`、无远程代码。
- 不要引入运行时依赖：`esbuild` / `typescript` / `@types/chrome` 都是 devDependencies，产物是自包含 IIFE。

## 探索规则（省积分，务必遵守）

- **找东西先派 `code-explorer` subagent**：「某个函数在哪」「改动会影响哪些文件」「这段链路怎么走」这类问题，用 `task(subagent_name="code-explorer")` 去做，它的搜索过程不进主上下文，只回传结论。
- 派活要自包含：问题与用途 / 已知与已排除 / 目录范围 / `thoroughness`（quick·medium·very thorough）/「只回结论与证据路径，不要贴代码」。
- 只有确实要落笔时才自己读文件；**一次读够**，不反复读同一区域。
- 小任务（一两个已知文件的定点改动）直接做，不要为省事反而多派一轮。

## 代码结构

```
src/
├── manifest.json                 # MV3 清单：background/content/popup/options 都指向 dist 内的相对路径
├── shared/                       # 所有上下文共用（无 chrome 专属 API 依赖，便于测试）
│   ├── types.ts                  # Settings / DictResult / Translate* / ProviderId 等类型
│   ├── constants.ts              # PROVIDER_LABELS、PROVIDER_IDS、SENTENCE_MODES、DICT_SOURCES、LANG_NAMES
│   ├── text.ts                   # hashStr / stripTags / textLooksZh / effectiveTargetLang /
│   │                             # buildPrompt / cleanOutput / splitSentences / splitChunks / mapLimit
│   ├── messaging/
│   │   ├── protocol.ts           # 消息类型 Envelope、端口名 AI_PORT、AiPortEvent（唯一定义处）
│   │   └── client.ts             # send / lookup / fetchSettings / saveSettings / testTranslate / openOptions
│   └── storage/
│       ├── settings.ts           # DEFAULT_SETTINGS + mergeSettings / applyPatch / getSettings / setSettings
│       └── cache.ts              # cacheKey / cacheGet / cacheSet / cacheClear（300 条，按时间戳淘汰）
├── background/                   # service worker：唯一有权调用远程 API 的上下文
│   ├── index.ts                  # 消息路由 / onConnect 流式 / 右键菜单 / attach()
│   ├── TranslationService.ts     # runOnce（缓存→通道→兜底→清洗→回写）、aiTranslate、aiTranslateParallel
│   ├── dictionary.ts             # buildLinks / fetchYoudaoJSON / parseYoudao / fetchWiktionary /
│   │                             # fetchFreeDictionary / fetchYoudaoSuggest / dictLookup
│   └── providers/
│       ├── types.ts              # Provider 接口（id + translate）
│       ├── index.ts              # PROVIDERS 注册表、PARALLEL_ALLOWED、runProvider、translateViaFreeMT
│       ├── OpenAIProvider.ts / DeepLProvider.ts / AzureProvider.ts /
│       ├── GoogleProvider.ts / LibreProvider.ts / FreeMTProvider.ts / ChromeAiProvider.ts
├── content/                      # 划词交互层（IIFE，页面上下文）
│   ├── index.ts                  # 幂等注入：已有实例先 destroy() 再重建
│   ├── TranslationController.ts  # 编排：选区 → 气泡 → 面板 → 翻译（并列/单条分流）
│   ├── selection/
│   │   ├── SelectionManager.ts   # mouseup / mousedown / keydown / selectionchange / scroll / resize
│   │   └── selection-utils.ts    # clamp / apply / place / placeTip / rectUsable / rangeRect / readSelection
│   ├── ui/
│   │   ├── shadow-root.ts        # HOST_ID / TIP_HOST_ID / mountHost / h / svgIcon / isOwnHost
│   │   ├── styles.css            # 面板与气泡样式（构建时以 text loader 内联进 content/index.js）
│   │   ├── FloatingButton.ts     # 气泡「译」按钮（46px 命中区，pointerdown 触发）
│   │   └── TranslationPanel.ts   # 面板构建与渲染、compareList、列对象
│   └── providers/
│       └── ChromeAiProvider.ts   # 本机 Gemini Nano（runChromeAi，仅页面上下文可用）
├── popup/index.html + index.ts
├── options/index.html + index.ts
└── icons/
```

### `src/manifest.json`
MV3 v2.2.0。`permissions`: `storage`、`contextMenus`（无 `identity`）。`host_permissions`: 有道 / dictionaryapi.dev / freedictionaryapi.com / MyMemory / Azure / Google / DeepL（含 api-free）/ `http://*/*` + `https://*/*`（自定义模型与本地 Ollama 需要）。`background.service_worker` = `background/index.js`；`content_scripts` 注入 `content/index.js`（`document_idle`，非 all_frames）；`action.default_popup` = `popup/index.html`；`options_ui.page` = `options/index.html`（`open_in_tab`）。

### background 侧要点
- `TranslationService.runOnce`：缓存键 `'ai:' + hashStr(provider|targetLang|kind|text)`；主通道失败且 `allowFallback` 时降级 `free-mt`；只缓存翻译结果，默认 `settings.cacheDays` 天。
- `aiTranslate`：单词判定用 `isWordLike`（≤3 词且 ≤40 字符）；目标语言统一过 `effectiveTargetLang`；句子可单独指定通道（`sentence.provider !== 'follow'`）；`sentence.mode === 'bilingual'` 且 `perSentence` 时走 `splitSentences` + `mapLimit(4)` 逐句翻译并回传 `pairs`。
- `aiTranslateParallel`：`PARALLEL_ALLOWED = deepl/azure/google/libre/openai/free-mt`，最多 4 列，**强制 `fallback:false, noPairs:true`**。
- 长连接只接 `port.name === 'ai'`，`start` 后回推 `chan` / `partial` / `done` / `error`；并列模式不发 `done`（主容器是 grid，清它会把两列一起抹掉）。
- `dictLookup` 按 `settings.sources` 只请求开着的来源，任一失败置 `partial = true`；展示顺序固定：有道 → 柯林斯 → 词形 → Wiktionary → Free Dictionary → 有道简明。
- `attach()` 只在 service worker 环境自动执行（`chrome.runtime.onMessage` 存在且无 `document`），`test-*.js` 的 vm 沙箱里不会挂监听。

### content 侧要点
- 宿主 id：`st-root-host`（面板）、`st-root-host-tip`（气泡）；`isOwnHost()` 判断事件是否发生在自己的浮层里。
- 定位：`place`（面板，above 优先）/ `placeTip`（气泡，右下优先逐边翻转）；`clamp` **无条件**把浮层夹在视口内。
- 选区：`rangeRect` **倒着找第一个有面积的 rect**（跨行选区末尾常是零宽的）；`readSelection` 处理 INPUT/TEXTAREA 的 `selectionStart/End`。
- 面板 `TranslationPanel` 的构造参数是 `getSettings: () => Settings`——设置要「活读」，开关改完设置后标签才能同步刷新。
- 渲染一律 `textContent`，绝不把选中文本拼进 `innerHTML`；词典 block 与双语例句默认展开（`det.open = true`）。
- 本机通道 `runChromeAi` 返回 `boolean`，false 表示不可用 → 交给 background 走降级链。
- 自动化就绪信号：`document.documentElement[data-st-ready=1]`（E2E 依赖它）。

### 设置结构 `DEFAULT_SETTINGS`（`src/shared/storage/settings.ts`）
顶层：`targetLang`、`trigger`、`aiEnabled`、`provider`、`fallbackEnabled`、`minLen`、`maxLen`、`cacheDays`
分组：`openai{baseUrl,apiKey,model}`、`deepl{apiKey}`、`azure{apiKey,region}`、`google{apiKey}`、`libre{baseUrl,apiKey}`、`sentence{provider,mode,perSentence,dict}`、`compare{enabled,providers}`（默认 `chrome-ai + deepl`）、`sources{youdao,collins,sentences,wiktionary,freedict,ydsimple}`

### `src/options/index.ts`
11 节：1 通道 / 2 自定义模型 / 3 DeepL / 4 Azure / 5 Google / 6 LibreTranslate / 7 句子翻译 / 8 翻译行为 / 9 词典来源 / 10 连通性测试 / 11 使用要点。
`CARD_OF` + `applyProvider` 按所选通道显隐凭据卡片；`loadSettings` 回显；`bind` 里每个控件各自 `settings:set`；`runTest` 走 `ai:translate`。
DOM 契约（改 id 必须同步两边）：`provider`、`openaiCard/deeplCard/azureCard/googleCard/libreCard`、`azKey/azRegion`、`ggKey`、`lbBase/lbKey`、`sentProvider/sentMode/sentPerSentence/sentDict`、`src-youdao/collins/sentences/wiktionary/freedict/ydsimple`、`aiEnabled`、`testInput/runTest/testOut`、`cmpEnabled/cmpPick`。

### `src/popup/index.ts`
`provider` 下拉 7 项、目标语言、触发方式、并列对照、词典来源（6 项）、设置、清缓存。`KEY_OF` 判断当前通道是否缺密钥 → `renderAuth` 显示状态点与提示。

## 验证与完成标准（Definition of Done）

改完必须全跑一遍（前两步等价于「构建 + 静态检查」）：

```bash
cd /Users/xhxie/Downloads/resources/selecttrans
npm run typecheck     # tsc --noEmit
npm run build         # esbuild → dist/
node test-providers.js   # 通道契约测试：stub fetch，断言 URL/头/body，无需密钥
node test-smoke.js       # 解析冒烟：真实请求有道 / Wiktionary / MyMemory
testkit run tests/e2e/selection-bubble.spec.mjs tests/e2e/pages.spec.mjs --extension=dist
```

- 必须**贴出验证日志**，不允许凭感觉说"完成了"。
- `test-providers.js` / `test-smoke.js` 用 `vm` 加载 **`dist/background/index.js`**（IIFE，全局名 `SelectTransBackground`），用的是 `sandbox.SelectTransBackground` 这个接口对象；所以改了 background 的导出就要同步测试里的 `api.xxx`。它们是 **CJS**（`require`），项目 package.json 没有 `"type": "module"`。
- `build.mjs` 的四个入口：`background/index.ts`（`globalName: SelectTransBackground`）、`content/index.ts`、`popup/index.ts`、`options/index.ts`；另外静态拷贝 manifest、两个 html、icons。`css` 走 `loader: {'.css':'text'}`。
- **同步结构图**：只要改了下面这些"接口"，就在同一次改动里更新本文档的「代码结构」——地图过期比没有地图更糟：
  - `chrome.runtime` 消息类型、`onConnect` 端口名与回推事件名（`chan`/`partial`/`done`/`error`）
  - `DEFAULT_SETTINGS` 字段（含 `sentence` / `compare` / `sources` 子结构）
  - 翻译通道的增删（`PROVIDERS` 注册表、`PARALLEL_ALLOWED`）
  - Shadow DOM 宿主 id（`st-root-host` / `st-root-host-tip`）与面板 CSS 类名
  - options / popup 里被 `$()` 取用的 DOM id
  - testkit 相关契约（如 `data-st-ready` 就绪标记）
- `selection-bubble.spec.mjs` 守着三个历史 bug：贴顶选区气泡被顶出视口（负 top）、跨行选区末尾零宽 rect、气泡命中区太小点不中；外加句子显示方式开关。改 `content/selection/` 或 `content/ui/` 的定位逻辑后这个 spec 必须过。
- `pages.spec.mjs` 守着设置页与弹窗的 DOM 契约（改 id 不同步就会 JS 报错），页面路径是 `chrome-extension://<id>/options/index.html` 与 `/popup/index.html`。

## 测试环境（机器级，不要在项目中重复安装）

- 工具包在 `~/dev/playwright-testkit`，全局命令 `testkit`；**不要**给本项目加 playwright/puppeteer 依赖。
- spec 是 ESM：`export default async function (t) {}`，`t` 提供 `launch / getExtensionId / serve / captureConsole / expect / waitFor / options / log`。
- 品牌版 Google Chrome 忽略 `--load-extension`，扩展测试必须用 Playwright 自带 Chromium；带 `--extension` 时 testkit 会自动切 `channel=chromium`。
- **坑**：CLI 的 `--extension` 只写进 `t.options.extensions`，`launch()` 不会自动带上，spec 里必须显式 `launch({ extensions: options.extensions })`，否则 content script 不注入。
- **坑**：content script 与页面 JS 隔离，`page.evaluate` 读不到挂在 `window` 上的变量；用共享 DOM 做标记（`data-st-ready`）。
- 扩展 ID 由扩展目录绝对路径推导，移动目录会变。

## 打包

```bash
npm run zip   # = npm run build + 在 dist/ 内打 selecttrans-<version>.zip
```

`manifest.json` 必须在压缩包根目录（构建产物天然满足）。验证方式：解压到临时目录，用 `--extension=<解压目录>` 跑一遍上面的 E2E。

## 已知边界（改代码前先扫一眼）

- 七个通道：`chrome-ai`（页面上下文）/ `deepl` / `azure` / `google` / `libre` / `openai` / `free-mt`。并列对照只允许远程通道（`PARALLEL_ALLOWED` 含 `libre`），且**不做 free-mt 兜底**，否则两列会显示同一结果。
- `chrome-ai` 只能在 content 侧调用；background 侧的 `ChromeAiProvider` 直接抛 `CHROME_AI_PAGE_ONLY`。
- 「原文已是中文时自动改译英语」必须在分发前统一算目标语言（shared `effectiveTargetLang`，两侧共用同一份）；只在 prompt 里翻转会让机器翻译通道照旧译成中文、甚至报 `FREE_MT_SAME_LANG`。
- 句子默认不查词典；句子可单独指定通道；并列模式下不产生逐句对照对（`noPairs`）。
- 有道 `jsonapi` / 有道 `suggest`、freedictionaryapi.com、MyMemory 均为非官方/有限额接口，失效时要能安全降级。
- 词典区块（柯林斯、词形、英英、双语例句）一律默认展开，`block.collapsed` 只表示「可折叠」，不再表示「初始收起」。
- 已下线、不要再接：腾讯混元 HY-MT2（`tencent` 通道整条移除）、腾讯翻译君 `fanyi.qq.com`、腾讯云 TMT `TextTranslate`、必应词典 HTML 抓取、WorkBuddy Open API。

## 架构取舍（改代码时一并遵守）

| 问题 | 本项目的处理 |
| --- | --- |
| 宿主页面 CSS 污染 | Shadow DOM（`shadow-root.ts` + `styles.css` 以文本内联） |
| 选区频繁变化 | `mouseup` + `selectionchange` 兜底并各自节流（180ms / 260ms） |
| 连续划词导致旧请求覆盖新结果 | 开面板即 `closePanel()` 断掉旧 port；`openOnce` 800ms 去重 |
| 页面滚动导致浮层位置错误 | scroll / resize 后直接收起面板与气泡 |
| 选区在输入框中 | `readSelection` 额外处理 `selectionStart` / `selectionEnd` |
| Content Script 重复注入 | `index.ts` 幂等：已有实例先 `destroy()` |
| API 密钥泄漏 | 密钥只存本机 `chrome.storage.local`，代码里不放任何服务端密钥 |
| 页面安全性 | 不把选中文本直接拼接进 `innerHTML`（一律 `textContent`） |
