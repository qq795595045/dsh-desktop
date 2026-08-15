#!/usr/bin/env bash
#
# 构建并发布 DSH Desktop 到 GitHub Releases,供自动更新使用。
#
# 用法:
#   export GH_TOKEN=<你的 GitHub 令牌(需 repo 权限)>
#   npm version patch            # 提升版本号(自动 git tag)
#   npm run release
#
# macOS 签名(可选,但自动更新必需):
#   export CSC_LINK=/path/to/DeveloperIDApplication.p12
#   export CSC_KEY_PASSWORD=xxx
#
# Apple 公证(可选,建议与签名一起启用):
#   export APPLE_ID=you@example.com
#   export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
#   export APPLE_TEAM_ID=XXXXXXXXXX
#
# 未签名时发布仍会成功,但 macOS 端应用会自动退化为「手动下载」模式。
#
set -euo pipefail
cd "$(dirname "$0")/.."

OWNER=$(node -e "console.log((require('./package.json').build.publish[0].owner || ''))")
REPO=$(node -e "console.log((require('./package.json').build.publish[0].repo || ''))")
VERSION=$(node -e "console.log(require('./package.json').version)")

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "错误: 未设置 GH_TOKEN。请先: export GH_TOKEN=ghp_xxx (需 repo 权限)"
  exit 1
fi

if [[ "$OWNER" == *"YOUR_GITHUB"* || -z "$OWNER" ]]; then
  echo "错误: package.json 中 build.publish[0].owner 仍是占位符。"
  echo "请先把它改成你的 GitHub 用户名或组织名。"
  exit 1
fi

if [[ -z "${CSC_LINK:-}" && -z "${CSC_NAME:-}" ]]; then
  export CSC_IDENTITY_AUTO_DISCOVERY=false
  echo "==> 未检测到签名证书,构建未签名版本(macOS 自动更新将退化为手动下载)"
else
  echo "==> 使用签名证书 (CSC_LINK / CSC_NAME)"
fi

EXTRA_ARGS=()
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  EXTRA_ARGS+=("-c.mac.notarize.teamId=${APPLE_TEAM_ID}")
  echo "==> 已启用 Apple 公证(notarize): teamId=${APPLE_TEAM_ID}"
else
  echo "==> 未配置公证(APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID),跳过公证"
fi

echo "==> 发布 ${OWNER}/${REPO} v${VERSION}"

ELECTRON_BUILDER_CACHE="${ELECTRON_BUILDER_CACHE:-$HOME/.cache/electron-builder}" \
  npx electron-builder --mac --publish always ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

echo "==> 完成: https://github.com/${OWNER}/${REPO}/releases/tag/v${VERSION}"
