'use strict';

/**
 * 更新模块(无 Electron 依赖,可被 CLI 脚本与主进程共用)。
 *
 * 职责:
 *   - 定位 dsh 可执行文件
 *   - 读取已安装版本 / 查询 npm 最新版本
 *   - 语义化版本比较(支持 rc/beta 等预发布标签)
 *   - 执行 `npm install -g @deepseek-ai/dsh@latest`
 *
 * 环境变量:
 *   DSH_BIN                强制指定 dsh 可执行文件路径
 *   DSH_DESKTOP_NPM_CACHE  覆盖 npm 缓存目录(默认 ~/.cache/dsh-desktop/npm-cache)
 *   DSH_DESKTOP_REGISTRY   覆盖 npm registry(默认 https://registry.npmjs.org)
 */

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const PKG = '@deepseek-ai/dsh';
const REGISTRY = process.env.DSH_DESKTOP_REGISTRY || 'https://registry.npmjs.org';

/** 定位 node 所在目录,失败退回常见位置。 */
function nodeBinDir() {
  const w = spawnSync('which', ['node'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) {
    return path.dirname(w.stdout.trim().split('\n')[0]);
  }
  const cands = [
    path.join(os.homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin'
  ];
  for (const c of cands) {
    if (fs.existsSync(path.join(c, process.platform === 'win32' ? 'node.exe' : 'node'))) return c;
  }
  return path.join(os.homedir(), '.local', 'bin');
}

/**
 * 供 GUI 启动场景使用:从 Finder/桌面双击启动时 PATH 是极简的,
 * dsh/npm 的 shebang `#!/usr/bin/env node` 会因此找不到 node。
 * 这里把 node 所在目录及常见 bin 目录前置到 PATH。
 */
function augmentedEnv() {
  const extra = [
    nodeBinDir(),
    path.join(os.homedir(), '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ];
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = { ...process.env };
  env.PATH = [...new Set([...extra, env.PATH || ''])].filter(Boolean).join(sep);
  return env;
}

function resolveNpm() {
  if (process.env.npm && fs.existsSync(process.env.npm)) return process.env.npm;
  const w = spawnSync('which', ['npm'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim().split('\n')[0];
  const cands = [
    path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'npm.cmd' : 'npm'),
    '/usr/local/bin/npm',
    '/opt/homebrew/bin/npm',
    '/usr/bin/npm'
  ];
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'npm';
}

function npmCmd() {
  return resolveNpm();
}

function npmCacheDir() {
  if (process.env.DSH_DESKTOP_NPM_CACHE) return process.env.DSH_DESKTOP_NPM_CACHE;
  return path.join(os.homedir(), '.cache', 'dsh-desktop', 'npm-cache');
}

/** 定位 dsh 可执行文件,返回绝对路径或 null。 */
function resolveDshBin() {
  if (process.env.DSH_BIN && fs.existsSync(process.env.DSH_BIN)) {
    return process.env.DSH_BIN;
  }
  const candidates = [];
  const which = spawnSync('which', ['dsh'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());
  try {
    const prefix = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8' });
    if (prefix.status === 0) {
      candidates.push(path.join(prefix.stdout.trim(), 'bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh'));
    }
  } catch (_) { /* ignore */ }
  candidates.push(
    path.join(os.homedir(), '.local', 'bin', 'dsh'),
    '/usr/local/bin/dsh',
    '/opt/homebrew/bin/dsh',
    '/usr/bin/dsh'
  );
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'dsh.cmd'));
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/** 解析 semver(兼容前导 v、构建元数据),失败返回 null。 */
function parseVersion(v) {
  const s = String(v).trim().replace(/^v/i, '');
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** 归一化版本字符串,便于展示;无效返回 null。 */
function normalizeVersion(v) {
  const p = parseVersion(v);
  if (!p) return null;
  return `${p.major}.${p.minor}.${p.patch}${p.pre.length ? '-' + p.pre.join('.') : ''}`;
}

/**
 * semver 比较:a < b 返回 -1,a === b 返回 0,a > b 返回 1。
 * 预发布 < 正式版;预发布按标识符逐段比较(数字段 < 字母段,短列表 < 长列表)。
 */
function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return String(a).localeCompare(String(b));
  for (const k of ['major', 'minor', 'patch']) {
    if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
  }
  if (!A.pre.length && !B.pre.length) return 0;
  if (!A.pre.length) return 1;
  if (!B.pre.length) return -1;
  const len = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < len; i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return d < 0 ? -1 : 1;
    } else if (xn) {
      return -1;
    } else if (yn) {
      return 1;
    } else {
      const c = x.localeCompare(y);
      if (c) return c < 0 ? -1 : 1;
    }
  }
  return 0;
}

/** 读取已安装 dsh 版本(归一化),失败返回 null。 */
function installedVersion() {
  const bin = resolveDshBin();
  if (!bin) return null;
  const r = spawnSync(bin, ['-V'], { encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) return null;
  return normalizeVersion(r.stdout);
}

/** 查询 npm 上 @deepseek-ai/dsh 的最新版本。 */
function latestVersion({ cacheDir } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['view', PKG, 'version', '--registry', REGISTRY];
    if (cacheDir) {
      fs.mkdirSync(cacheDir, { recursive: true });
      args.push('--cache', cacheDir);
    }
    const child = spawn(npmCmd(), args, { shell: process.platform === 'win32', env: augmentedEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        const v = normalizeVersion(out);
        if (v) return resolve(v);
      }
      reject(new Error((err || out || `npm view exited ${code}`).trim()));
    });
  });
}

/**
 * 执行 `npm install -g @deepseek-ai/dsh@latest`。
 * 逐行回调 onLine(文本片段),解析为 { ok, output }。
 */
function runDshUpdate({ cacheDir, onLine } = {}) {
  return new Promise((resolve) => {
    const args = ['install', '-g', `${PKG}@latest`, '--registry', REGISTRY, '--no-audit', '--no-fund'];
    if (cacheDir) {
      fs.mkdirSync(cacheDir, { recursive: true });
      args.push('--cache', cacheDir);
    }
    const child = spawn(npmCmd(), args, {
      shell: process.platform === 'win32',
      env: augmentedEnv()
    });
    let output = '';
    const push = (chunk) => {
      const s = String(chunk);
      output += s;
      if (onLine) onLine(s);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => {
      output += String(e && e.message ? e.message : e);
      resolve({ ok: false, output });
    });
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}

module.exports = {
  PKG,
  REGISTRY,
  npmCmd,
  resolveNpm,
  npmCacheDir,
  nodeBinDir,
  augmentedEnv,
  resolveDshBin,
  parseVersion,
  normalizeVersion,
  compareVersions,
  installedVersion,
  latestVersion,
  runDshUpdate
};
