'use strict';

/**
 * 命令行:检查 DSH 引擎是否有更新(读取已安装版本 + 查询 npm 最新版本)。
 * 用法: node scripts/check-dsh.js
 */

const updater = require('../updater');

async function main() {
  const cur = updater.installedVersion();
  console.log(`已安装: ${cur ? 'v' + cur : '(未找到 dsh)'}`);

  try {
    const latest = await updater.latestVersion({ cacheDir: updater.npmCacheDir() });
    console.log(`最新版: v${latest}`);
    if (cur) {
      const cmp = updater.compareVersions(latest, cur);
      console.log(cmp > 0 ? '有更新可用!' : cmp < 0 ? '已安装版本高于最新版(预发布/本地构建)。' : '已是最新。');
      process.exit(cmp > 0 ? 1 : 0);
    }
  } catch (e) {
    console.error(`查询失败: ${e.message || e}`);
    process.exit(2);
  }
}

main();
