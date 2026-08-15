'use strict';

/**
 * DSH Desktop —— Electron 主进程。
 *
 * 职责:
 *   1. 以子进程方式启动 `dsh web`(默认让 OS 分配空闲端口),解析其打印的
 *      `dsh web: http://127.0.0.1:<port>` 行得到真实地址。
 *   2. 创建原生窗口并加载该地址,管理服务生命周期(退出/重启)。
 *   3. 提供菜单:检查/更新 DSH 引擎、重启服务、更新应用外壳、打开日志。
 *   4. `--smoke-test` 冒烟模式:启动并等待页面加载成功后自动退出。
 */

const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const updater = require('./updater');
const autoupdate = require('./autoupdate');

const APP_NAME = 'DSH Desktop';
const DEFAULT_URL = 'http://127.0.0.1:3080';
const URL_RE = /dsh web:\s+(https?:\/\/\S+)/;
const BOOT_TIMEOUT_MS = 30000;

const isSmokeTest = process.argv.includes('--smoke-test');
const isMock = process.env.DSH_DESKTOP_MOCK === '1';

// 可移植/隔离模式:允许把 userData(日志、Chromium 缓存等)重定向到指定目录。
if (process.env.DSH_DESKTOP_USER_DATA) {
  app.setPath('userData', process.env.DSH_DESKTOP_USER_DATA);
}

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let stdoutBuf = '';
let isQuitting = false;
let logStream = null;

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

function logDir() {
  const d = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => String(p)).join(' ')}\n`;
  process.stdout.write(line);
  try {
    if (logStream) logStream.write(line);
  } catch (_) { /* ignore */ }
}

function openLogStream() {
  try {
    logStream = fs.createWriteStream(path.join(logDir(), 'dsh-desktop.log'), { flags: 'a' });
  } catch (e) {
    process.stderr.write(`无法打开日志文件: ${e.message}\n`);
  }
}

// ---------------------------------------------------------------------------
// dsh 服务生命周期
// ---------------------------------------------------------------------------

function resolveDshBin() {
  return updater.resolveDshBin();
}

function spawnServer() {
  let child;
  if (isMock) {
    log('mock mode: skipping dsh binary');
    stdoutBuf = '';
    serverUrl = null;
    child = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], {
      env: updater.augmentedEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    log('spawning mock server');
  } else {
    const bin = resolveDshBin();
    if (!bin) {
      const msg = [
        '未找到 dsh 命令。请先安装 DeepSeek Harness CLI:',
        '',
        '    npm install -g @deepseek-ai/dsh@latest',
        '',
        '或设置环境变量 DSH_BIN 指向 dsh 可执行文件。'
      ].join('\n');
      log('fatal: dsh binary not found');
      dialog.showErrorBox(`${APP_NAME} —— 未找到 dsh`, msg);
      if (isSmokeTest) app.exit(1);
      return null;
    }
    log('using dsh binary:', bin);
    stdoutBuf = '';
    serverUrl = null;
    child = spawn(bin, ['web', '--port', '0'], {
      env: updater.augmentedEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    log('spawning dsh web --port 0');
  }

  serverProcess = child;

  child.stdout.on('data', (chunk) => {
    const s = String(chunk);
    log('[dsh]', s.replace(/\s+$/, ''));
    stdoutBuf += s;
    const m = URL_RE.exec(stdoutBuf);
    if (m && !serverUrl) {
      serverUrl = m[1];
      log('resolved server url:', serverUrl);
      onServerUrlResolved(serverUrl);
    }
  });

  child.stderr.on('data', (chunk) => {
    const s = String(chunk);
    log('[dsh:err]', s.replace(/\s+$/, ''));
  });

  child.on('error', (err) => {
    log('dsh spawn error:', err.message);
    if (isSmokeTest) {
      console.error(`SMOKE_FAIL spawn error: ${err.message}`);
      app.exit(1);
    } else {
      dialog.showErrorBox(`${APP_NAME} —— 启动失败`, `无法启动 dsh 服务:\n\n${err.message}`);
    }
  });

  child.on('exit', (code, signal) => {
    log(`dsh exited code=${code} signal=${signal}`);
    if (serverProcess === child) serverProcess = null;
    if (!isQuitting && !isSmokeTest && mainWindow) {
      // 意外退出:提示用户
      dialog.showErrorBox(
        `${APP_NAME} —— 服务已停止`,
        `dsh 服务意外退出(code=${code}${signal ? ', signal=' + signal : ''})。\n请点击“DSH → 重启服务”重新启动。`
      );
    }
  });

  // 兜底:30s 内没解析到 URL,尝试默认端口
  setTimeout(() => {
    if (!serverUrl && serverProcess === child) {
      log('warn: no URL line parsed, falling back to', DEFAULT_URL);
      serverUrl = DEFAULT_URL;
      onServerUrlResolved(serverUrl);
    }
  }, BOOT_TIMEOUT_MS);

  return child;
}

function killServer() {
  const child = serverProcess;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  });
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'assets', 'loading.html'));

  mainWindow.once('ready-to-show', () => {
    if (!isSmokeTest) mainWindow.show();
  });

  // 外链走系统浏览器,窗口内不新开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function waitForUrl(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(attempt, 250);
      });
      req.setTimeout(2000, () => { req.destroy(); });
    };
    attempt();
  });
}

async function onServerUrlResolved(url) {
  if (!mainWindow) return;
  const ok = await waitForUrl(url);
  if (!ok) {
    log('warn: server did not answer at', url);
  }
  if (isSmokeTest) {
    console.log(`SMOKE_OK ${url}`);
    app.exit(0);
    return;
  }
  log('loading', url);
  mainWindow.loadURL(url);
}

async function restartServer() {
  log('restarting dsh server…');
  await killServer();
  spawnServer();
}

// ---------------------------------------------------------------------------
// 更新进度窗口
// ---------------------------------------------------------------------------

function showProgress(title) {
  const win = new BrowserWindow({
    width: 760,
    height: 460,
    title: title || `${APP_NAME} —— 更新`,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'assets', 'update.html'));
  win.once('ready-to-show', () => win.show());

  let ready = false;
  let queue = [];
  win.webContents.once('did-finish-load', () => {
    ready = true;
    for (const line of queue) appendNow(line);
    queue = [];
  });

  function appendNow(line) {
    const safe = String(line);
    win.webContents.executeJavaScript(
      `window.__appendLog && window.__appendLog(${JSON.stringify(safe)});`
    ).catch(() => { /* ignore */ });
  }

  function append(line) {
    if (ready) appendNow(line);
    else queue.push(line);
  }

  function done() {
    try { win.close(); } catch (_) { /* ignore */ }
  }

  return { win, append, done };
}

// ---------------------------------------------------------------------------
// 更新流程
// ---------------------------------------------------------------------------

async function checkDshUpdateInteractive() {
  const cur = updater.installedVersion();
  const curLabel = cur ? `v${cur}` : '未知(未找到 dsh)';

  let latest;
  try {
    latest = await updater.latestVersion({ cacheDir: updater.npmCacheDir() });
  } catch (e) {
    dialog.showErrorBox(`${APP_NAME} —— 检查更新失败`, `无法查询最新版本:\n\n${e.message || e}`);
    return;
  }

  const newer = cur && compareSafe(latest, cur) > 0;
  const detail = `当前版本: ${curLabel}\n最新版本: v${latest}`;

  if (!cur) {
    await dialog.showMessageBox({ type: 'warning', title: 'DSH 引擎更新', message: '未找到 dsh', detail });
  } else if (newer) {
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['立即更新并重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      title: 'DSH 引擎更新',
      message: '发现新版本',
      detail: `${detail}\n\n将执行: npm install -g @deepseek-ai/dsh@latest`
    });
    if (r.response === 0) await doUpdateAndRestart();
  } else {
    await dialog.showMessageBox({ type: 'info', title: 'DSH 引擎更新', message: '已是最新', detail });
  }
}

function compareSafe(a, b) {
  try { return updater.compareVersions(a, b); } catch (_) { return 0; }
}

async function doUpdateAndRestart() {
  const progress = showProgress('正在更新 DSH 引擎…');
  progress.append('==> npm install -g @deepseek-ai/dsh@latest\n');
  progress.append(`==> npm 缓存目录: ${updater.npmCacheDir()}\n\n`);

  try {
    const res = await updater.runDshUpdate({
      cacheDir: updater.npmCacheDir(),
      onLine: (s) => progress.append(s)
    });
    if (res.ok) {
      progress.append('\n✅ 更新完成,正在重启服务…\n');
      await new Promise((r) => setTimeout(r, 1000));
      await restartServer();
      const v = updater.installedVersion();
      progress.done();
      dialog.showMessageBox({
        type: 'info',
        title: 'DSH 引擎更新',
        message: '更新完成',
        detail: `当前版本: ${v ? `v${v}` : '未知'}`
      });
    } else {
      progress.append('\n❌ 更新失败,详见下方日志。\n');
      const tail = res.output.slice(-4000);
      dialog.showErrorBox(`${APP_NAME} —— 更新失败`, tail || '(无输出)');
    }
  } catch (e) {
    progress.append(`\n❌ 异常: ${e && e.message ? e.message : e}\n`);
    dialog.showErrorBox(`${APP_NAME} —— 更新失败`, String(e && e.message ? e.message : e));
  } finally {
    progress.done();
  }
}

// 应用外壳更新入口:打包态走 electron-updater(或手动下载回退);开发模式走 git pull。
function checkAppShellUpdate() {
  if (app.isPackaged) {
    autoupdate.checkInteractive();
    return;
  }
  devGitPull();
}

async function devGitPull() {
  const script = path.join(__dirname, 'scripts', 'update-app.sh');
  if (!fs.existsSync(script)) {
    dialog.showErrorBox(`${APP_NAME} —— 更新应用外壳`, '未找到 scripts/update-app.sh');
    return;
  }
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['更新并重启应用', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '更新应用外壳',
    message: '更新 DSH Desktop 应用本身',
    detail: '将执行 git pull + npm install,随后需要手动重启应用。\n\n(此功能要求应用目录是一个 git 仓库,且已配置 remote。)'
  });
  if (r.response !== 0) return;

  const progress = showProgress('正在更新应用外壳…');
  progress.append('==> scripts/update-app.sh\n\n');
  const child = spawn('bash', [script], { env: updater.augmentedEnv() });
  child.stdout.on('data', (d) => progress.append(String(d)));
  child.stderr.on('data', (d) => progress.append(String(d)));
  child.on('close', (code) => {
    progress.append(`\n${code === 0 ? '✅ 更新完成,请重启应用。' : `❌ 脚本退出码 ${code}`}\n`);
  });
  child.on('error', (e) => progress.append(`\n❌ ${e.message}\n`));
}

// ---------------------------------------------------------------------------
// 菜单
// ---------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    {
      label: 'DSH',
      submenu: [
        { label: '检查 DSH 引擎更新…', click: () => checkDshUpdateInteractive() },
        { label: '更新 DSH 引擎并重启…', click: () => doUpdateAndRestart() },
        { type: 'separator' },
        { label: '重启服务', accelerator: 'CmdOrCtrl+Shift+R', click: async () => { await restartServer(); } },
        { type: 'separator' },
        { label: '打开日志目录', click: () => shell.openPath(logDir()) },
        { label: '打开开发者工具', role: 'toggleDevTools' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查应用外壳更新…', click: () => checkAppShellUpdate() },
        { type: 'separator' },
        { label: '关于', click: () => showAbout() }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  const dshVersion = updater.installedVersion();
  dialog.showMessageBox({
    type: 'info',
    title: `关于 ${APP_NAME}`,
    message: APP_NAME,
    detail: [
      `应用版本: ${app.getVersion()}`,
      `DSH 引擎: ${dshVersion ? 'v' + dshVersion : '未安装'}`,
      '',
      '将 DeepSeek Harness 的 Web 界面封装为原生桌面应用。',
      '菜单「DSH → 检查 DSH 引擎更新」可一键更新引擎并重启。'
    ].join('\n')
  });
}

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    openLogStream();
    log('=== DSH Desktop starting ===');
    log('app version:', app.getVersion());
    log('electron:', process.versions.electron, 'node:', process.versions.node);
    log('dsh binary:', resolveDshBin() || '(not found)');
    log('mock mode:', isMock, 'smoke test:', isSmokeTest);

    createWindow();
    buildMenu();
    spawnServer();

    autoupdate.init(log);
    autoupdate.startupCheck();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async (e) => {
    if (isQuitting) return;
    isQuitting = true;
    // 保证子进程被回收
    await killServer();
  });
}
