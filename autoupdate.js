'use strict';

/**
 * 应用外壳自动更新(electron-updater + GitHub Releases)。
 *
 * 策略:
 *   - 仅在打包态且具备以下条件时启用 electron-updater:
 *       1. 已配置 GitHub 发布源(package.json 的 build.publish 或 repository);
 *       2. macOS 下应用已用 Developer ID 签名(Squirrel.Mac 要求)。
 *   - 不满足时退化为「手动下载」:弹窗引导打开 GitHub Releases 下载页。
 *   - Windows(NSIS)/Linux(AppImage)可免签名自动更新。
 *
 * 环境变量:
 *   DSH_DESKTOP_DISABLE_AUTOUPDATE=1  强制禁用自动更新(回到手动下载)
 */

const { app, dialog, shell, BrowserWindow } = require('electron');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pkg = require('./package.json');

let autoUpdater = null;
let logFn = () => {};
let activeProgress = null;

// ---------------------------------------------------------------------------
// 配置读取
// ---------------------------------------------------------------------------

function publishConfig() {
  const pub = (pkg.build && pkg.build.publish) || [];
  const arr = Array.isArray(pub) ? pub : [pub];
  return arr.find((p) => p.provider === 'github') || arr[0] || null;
}

function feedOwnerRepo() {
  const c = publishConfig();
  if (c && c.owner && c.repo) return { owner: c.owner, repo: c.repo };
  const repoUrl = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  const m = /github\.com[:/]([^/]+)\/([^/.#]+)/.exec(String(repoUrl));
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  return null;
}

function releasesUrl() {
  const or = feedOwnerRepo();
  return or ? `https://github.com/${or.owner}/${or.repo}/releases/latest` : null;
}

function isConfigured() {
  return !!feedOwnerRepo();
}

function isSigned() {
  if (process.platform !== 'darwin') return true;
  const r = spawnSync('codesign', ['-dv', app.getPath('exe')], { encoding: 'utf8' });
  if (r.status !== 0) return false;
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (/Signature=adhoc/.test(out)) return false;
  return /Signature=/.test(out);
}

function autoUpdateSupported() {
  if (process.env.DSH_DESKTOP_DISABLE_AUTOUPDATE === '1') return false;
  if (!app.isPackaged) return false;
  if (!isConfigured()) return false;
  if (process.platform === 'darwin' && !isSigned()) return false;
  return true;
}

function disabledReason() {
  if (process.env.DSH_DESKTOP_DISABLE_AUTOUPDATE === '1') return '已通过环境变量禁用';
  if (!app.isPackaged) return '开发模式(未打包)';
  if (!isConfigured()) return '未配置 GitHub 发布源';
  if (process.platform === 'darwin' && !isSigned()) return 'macOS 应用未签名';
  return '未知原因';
}

// ---------------------------------------------------------------------------
// 进度窗口
// ---------------------------------------------------------------------------

function showProgress(title) {
  const win = new BrowserWindow({
    width: 720,
    height: 320,
    title: title || '应用外壳更新',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
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
    win.webContents.executeJavaScript(
      `window.__appendLog && window.__appendLog(${JSON.stringify(String(line))});`
    ).catch(() => { /* ignore */ });
  }
  function append(line) { if (ready) appendNow(line); else queue.push(line); }
  function done() { try { win.close(); } catch (_) { /* ignore */ } }

  return { win, append, done };
}

function closeProgress() {
  if (activeProgress) { activeProgress.done(); activeProgress = null; }
}

// ---------------------------------------------------------------------------
// 初始化与事件
// ---------------------------------------------------------------------------

function init(log) {
  logFn = log || (() => {});
  if (!autoUpdateSupported()) {
    logFn('auto-update: disabled —', disabledReason());
    return null;
  }
  const { autoUpdater: au } = require('electron-updater');
  autoUpdater = au;

  au.logger = {
    info: (...a) => logFn('[updater]', ...a),
    warn: (...a) => logFn('[updater:warn]', ...a),
    error: (...a) => logFn('[updater:error]', ...a),
    debug: (...a) => logFn('[updater:debug]', ...a)
  };
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;

  au.on('update-available', (info) => {
    logFn('update available:', info.version);
  });
  au.on('update-not-available', (info) => {
    logFn('no update available:', info && info.version);
  });
  au.on('update-downloaded', (info) => {
    closeProgress();
    logFn('update downloaded:', info.version);
    dialog.showMessageBox({
      type: 'info',
      title: '应用外壳更新',
      message: `新版本 v${info.version} 已下载完成`,
      detail: '重启后自动安装。',
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) au.quitAndInstall();
    });
  });
  au.on('error', (err) => {
    logFn('auto-update error:', err && err.message ? err.message : err);
  });

  logFn('auto-update: enabled —', releasesUrl());
  return au;
}

/** 启动时静默检查(后台下载,完成后提示重启)。 */
function startupCheck() {
  if (!autoUpdater) return;
  autoUpdater.checkForUpdates().catch((e) => {
    logFn('startup check failed:', e && e.message ? e.message : e);
  });
}

// ---------------------------------------------------------------------------
// 交互式检查
// ---------------------------------------------------------------------------

function fallbackManual() {
  const url = releasesUrl();
  const buttons = url ? ['打开下载页面', '取消'] : ['确定'];
  const r = dialog.showMessageBoxSync({
    type: 'info',
    title: '应用外壳更新',
    message: '自动更新暂不可用',
    detail: [
      `原因: ${disabledReason()}`,
      '',
      '可手动下载最新版本安装包替换当前应用。',
      url ? '' : '请先在 package.json 中配置 GitHub 仓库(owner/repo)。'
    ].filter(Boolean).join('\n'),
    buttons,
    defaultId: 0,
    cancelId: url ? 1 : 0
  });
  if (r === 0 && url) shell.openExternal(url);
}

function checkInteractive() {
  if (!autoUpdater) {
    fallbackManual();
    return;
  }

  const onProgress = (p) => {
    if (activeProgress && p && typeof p.percent === 'number') {
      activeProgress.append(`下载进度: ${p.percent.toFixed(1)}%\n`);
    }
  };

  const cleanup = () => {
    autoUpdater.removeListener('download-progress', onProgress);
    autoUpdater.removeListener('update-not-available', onNoUpdate);
    autoUpdater.removeListener('error', onError);
  };
  const onNoUpdate = (info) => {
    cleanup();
    closeProgress();
    dialog.showMessageBox({
      type: 'info',
      title: '应用外壳更新',
      message: '已是最新',
      detail: `当前版本: v${app.getVersion()}`
    });
  };
  const onError = (e) => {
    cleanup();
    closeProgress();
    dialog.showErrorBox('应用外壳更新', `检查失败:\n${e && e.message ? e.message : e}`);
  };

  autoUpdater.on('download-progress', onProgress);
  autoUpdater.once('update-not-available', onNoUpdate);
  autoUpdater.once('error', onError);

  // 一旦有新版本即打开进度窗口(下载由 autoDownload=true 自动开始)
  autoUpdater.once('update-available', (info) => {
    activeProgress = showProgress(`正在下载 DSH Desktop v${info.version}…`);
    activeProgress.append(`发现新版本 v${info.version},开始后台下载…\n`);
    activeProgress.append(`(当前版本 v${app.getVersion()})\n\n`);
  });

  autoUpdater.checkForUpdates().catch((e) => onError(e));
}

module.exports = {
  init,
  startupCheck,
  checkInteractive,
  autoUpdateSupported,
  isConfigured,
  isSigned,
  feedOwnerRepo,
  releasesUrl,
  disabledReason
};
