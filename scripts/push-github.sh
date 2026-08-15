#!/usr/bin/env bash
#
# 把本地仓库接入 GitHub 并推送:更新 package.json 的 repository / publish 配置,
# 配置 git remote,然后推送到默认分支。
#
# 用法:
#   bash scripts/push-github.sh owner/repo
#   bash scripts/push-github.sh https://github.com/owner/repo
#
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "用法: bash scripts/push-github.sh <owner/repo | https://github.com/owner/repo>"
  exit 1
fi

TARGET="${TARGET%.git}"
if [[ "$TARGET" == http* ]]; then
  OWNER=$(echo "$TARGET" | sed -E 's#https?://github.com/([^/]+)/([^/]+).*#\1#')
  REPO=$(echo "$TARGET" | sed -E 's#https?://github.com/([^/]+)/([^/]+).*#\2#')
else
  OWNER="${TARGET%/*}"
  REPO="${TARGET#*/}"
fi

if [[ -z "$OWNER" || -z "$REPO" || "$OWNER" == "$TARGET" ]]; then
  echo "错误: 无法解析仓库。请用 owner/repo 或 https://github.com/owner/repo 格式。"
  exit 1
fi

echo "==> 仓库: ${OWNER}/${REPO}"

node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
p.repository = { type: 'git', url: 'https://github.com/${OWNER}/${REPO}.git' };
const pub = p.build.publish[0];
pub.owner = '${OWNER}';
pub.repo = '${REPO}';
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
console.log('已更新 package.json 的 repository 与 build.publish');
"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/${OWNER}/${REPO}.git"
else
  git remote add origin "https://github.com/${OWNER}/${REPO}.git"
fi
echo "==> 推送到分支 ${BRANCH}"
git push -u origin "$BRANCH"

echo ""
echo "✅ 已推送。下一步(发布第一个自动更新版本):"
echo "   export GH_TOKEN=<你的 GitHub 令牌,需 repo 权限>"
echo "   npm version patch && npm run release"
