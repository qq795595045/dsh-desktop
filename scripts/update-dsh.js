'use strict';

/**
 * 命令行:更新 DSH 引擎(npm install -g @deepseek-ai/dsh@latest)。
 * 用法: node scripts/update-dsh.js
 */

const updater = require('../updater');

async function main() {
  console.log(`==> npm install -g @deepseek-ai/dsh@latest`);
  console.log(`==> 缓存目录: ${updater.npmCacheDir()}\n`);
  const res = await updater.runDshUpdate({
    cacheDir: updater.npmCacheDir(),
    onLine: (s) => process.stdout.write(s)
  });
  if (res.ok) {
    console.log(`\n✅ 更新完成,当前版本: v${updater.installedVersion() || '未知'}`);
    process.exit(0);
  } else {
    console.error('\n❌ 更新失败');
    process.exit(1);
  }
}

main();
