/* 划词译 · 构建脚本
 * esbuild 把 src/**\/*.ts 打包成 dist/ 下可直接加载的 MV3 产物。
 * 用法：
 *   node build.mjs            一次性构建
 *   node build.mjs --watch    监听改动
 *   node build.mjs --zip      构建后额外打一个可上传商店的 zip
 */
import { rm, mkdir, cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const p = (...parts) => path.join(ROOT, ...parts);

const watch = process.argv.includes('--watch');
const doZip = process.argv.includes('--zip');

/** 四个入口：service worker / content script / 弹窗 / 设置页 */
const ENTRIES = [
  {
    entry: 'src/background/index.ts',
    outfile: 'dist/background/index.js',
    // 暴露成全局对象：test-providers.js / test-smoke.js 用 vm 加载它做纯函数测试
    globalName: 'SelectTransBackground',
  },
  { entry: 'src/content/index.ts', outfile: 'dist/content/index.js' },
  { entry: 'src/popup/index.ts', outfile: 'dist/popup/index.js' },
  { entry: 'src/options/index.ts', outfile: 'dist/options/index.js' },
];

/** 纯静态拷贝：manifest、图标、两个页面 */
const STATIC = [
  ['src/manifest.json', 'dist/manifest.json'],
  ['src/popup/index.html', 'dist/popup/index.html'],
  ['src/options/index.html', 'dist/options/index.html'],
  ['src/icons', 'dist/icons'],
];

const BASE = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  loader: { '.css': 'text' },
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
};

async function clean() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

async function copyStatic() {
  for (const [from, to] of STATIC) {
    if (!existsSync(p(from))) throw new Error('缺少静态资源：' + from);
    await mkdir(path.dirname(p(to)), { recursive: true });
    await cp(p(from), p(to), { recursive: true });
  }
}

async function zip() {
  const manifest = JSON.parse(await readFile(p('dist/manifest.json'), 'utf8'));
  const name = `selecttrans-${manifest.version}.zip`;
  await rm(p('dist', name), { force: true });
  execFileSync('zip', ['-r', '-q', '-X', name, '.', '-x', '*.DS_Store', '*__MACOSX*'], { cwd: DIST });
  console.log('[zip] dist/' + name);
}

await clean();

const contexts = [];
for (const e of ENTRIES) {
  contexts.push(await esbuild.context({
    ...BASE,
    entryPoints: [p(e.entry)],
    outfile: p(e.outfile),
    ...(e.globalName ? { globalName: e.globalName } : {}),
  }));
}

await Promise.all(contexts.map((c) => c.rebuild()));
await copyStatic();

if (watch) {
  console.log('[watch] 监听中…');
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.dispose()));
  if (doZip) await zip();
}
