'use strict';

/**
 * 生成应用图标 assets/icon.png(1024x1024)。
 * 数据源: assets/deepseek.svg(Simple Icons 的 DeepSeek 官方鲸鱼)。
 * 通过 Electron 离屏渲染 SVG → PNG(白底,蓝色 #4D6BFE 鲸鱼)。
 *
 * 用法: npm run icon
 * 更新 SVG: curl -sL "https://cdn.simpleicons.org/deepseek/4D6BFE" -o assets/deepseek.svg
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'deepseek.svg');
const OUT = path.join(ROOT, 'assets', 'icon.png');
const SIZE = 1024;

if (!fs.existsSync(SVG)) {
  console.error('缺少 assets/deepseek.svg,请先下载:');
  console.error('  curl -sL "https://cdn.simpleicons.org/deepseek/4D6BFE" -o assets/deepseek.svg');
  process.exit(1);
}

const renderScript = `
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const SRC = ${JSON.stringify(SVG)};
const OUT = ${JSON.stringify(OUT)};
const SIZE = ${SIZE};
app.whenReady().then(async () => {
  const svgText = fs.readFileSync(SRC, 'utf8');
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;width:' + SIZE + 'px;height:' + SIZE + 'px;background:#fff;overflow:hidden}' +
    'svg{width:100%;height:100%;display:block}</style></head><body>' + svgText + '</body></html>';
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG());
  console.log('已生成图标:', OUT);
  app.quit();
});
`;

const tmp = path.join(ROOT, '.render-icon.js');
fs.writeFileSync(tmp, renderScript);
try {
  const electronBin = path.join(ROOT, 'node_modules', '.bin', 'electron');
  const res = spawnSync(electronBin, [tmp, '--no-sandbox', '--disable-gpu'], { stdio: 'inherit' });
  process.exit(res.status || 0);
} finally {
  fs.unlinkSync(tmp);
}
