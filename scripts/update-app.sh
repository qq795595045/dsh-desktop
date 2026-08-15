#!/usr/bin/env bash
#
# 更新 DSH Desktop 应用外壳:git pull + 重装依赖。
# 要求:应用目录是 git 仓库,且已配置 remote(首次: git init && git remote add origin <url>)。
#
set -euo pipefail

cd "$(dirname "$0")/.."

NPM_CACHE="${DSH_DESKTOP_NPM_CACHE:-$HOME/.cache/dsh-desktop/npm-cache}"

echo "==> 拉取最新代码 (git pull --ff-only)"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误:当前目录不是 git 仓库。请先执行:"
  echo "    git init && git remote add origin <你的仓库地址> && git push -u origin main"
  exit 1
fi

if ! git pull --ff-only; then
  echo "错误:git pull 失败(可能未配置 remote 或有本地冲突)。"
  exit 1
fi

echo "==> 重装依赖 (npm install)"
npm install --cache "$NPM_CACHE" --no-audit --no-fund

echo "==> 完成。请重新启动 DSH Desktop。"
