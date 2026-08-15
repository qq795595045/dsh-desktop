'use strict';

/**
 * 轻量设置模块:读写 <userData>/settings.json。
 * 目前只用于「引擎自动更新方式」等少量开关,便于后续扩展。
 */

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  // 引擎自动更新方式: 'prompt' | 'auto' | 'off'
  engineAutoUpdate: 'prompt',
  // 用户已「稍后」跳过的引擎版本(不再重复弹窗,直到出现更新版本)
  engineSkipVersion: null
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  const dir = path.dirname(settingsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n');
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  const s = load();
  s[key] = value;
  save(s);
  return s;
}

module.exports = { DEFAULTS, load, save, get, set, settingsPath };
