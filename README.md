# DSH Desktop

将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面(`dsh web`)
封装为原生桌面应用:以 Electron 外壳托管 `dsh web` 服务,并提供内置的引擎更新与自更新能力。

[![GitHub release](https://img.shields.io/github/v/release/qq795595045/dsh-desktop)](https://github.com/qq795595045/dsh-desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/qq795595045/dsh-desktop/total)](https://github.com/qq795595045/dsh-desktop/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 安装(普通用户)

1. 到 [Releases](https://github.com/qq795595045/dsh-desktop/releases/latest) 下载 `DSH-Desktop-*-arm64.dmg`(或 `.zip`)
2. 双击 `.dmg` 后把 `DSH Desktop` 拖进「应用程序」
3. 首次打开:右键 →「打开」(未签名),或执行 `xattr -cr "DSH Desktop.app"`
4. 需已安装 DeepSeek Harness CLI(见下方「环境要求」)

> 已安装用户:应用启动时会自动检查更新(菜单「帮助 → 检查应用外壳更新…」);引擎更新在菜单「DSH → 检查 DSH 引擎更新…」。

## 功能

- **原生桌面窗口**:启动即拉起 `dsh web`(默认让系统分配空闲端口),窗口加载本地 GUI。
- **服务生命周期管理**:退出时自动回收 `dsh` 子进程;菜单可一键「重启服务」。
- **引擎在线更新**:菜单「DSH → 检查 DSH 引擎更新 / 更新并重启」,本质是
  `npm install -g @deepseek-ai/dsh@latest`,完成后自动重启服务并刷新页面。
- **应用外壳更新**:开发模式下 `git pull + npm install` 自更新;打包版提示用新安装包替换。
- **日志落盘**:`~/Library/Application Support/DSH Desktop/logs/dsh-desktop.log`。

## 环境要求

- macOS / Linux / Windows
- Node.js ≥ 22(需已安装 `dsh` CLI,见下)
- 已安装 DeepSeek Harness CLI:

```bash
npm install -g @deepseek-ai/dsh@latest
```

> 若你的全局 npm 缓存存在 root-owned 文件问题(常见于旧版 npm),先执行:
> `sudo chown -R $(id -u):$(id -g) ~/.npm`

## 开发与运行

```bash
cd dsh-desktop
npm install            # 安装 electron / electron-builder
npm start              # 直接以源码运行
```

冒烟测试(启动→解析 URL→加载页面→自动退出):

```bash
npm run smoke                  # 使用真实 dsh web
DSH_DESKTOP_MOCK=1 npm run smoke   # 使用内置 mock 服务器
```

## 打包

```bash
npm run icon          # (可选)重新生成 assets/icon.png
npm run pack          # 产出未压缩的 .app(目录)
npm run dist          # 产出 .dmg 与 .zip(仅 macOS)
npm run dist:all      # 全平台
```

产物在 `release/` 目录。macOS 下未签名,首次打开请右键 →「打开」,
或执行 `xattr -cr "DSH Desktop.app"`。

## 更新机制

### 1. DSH 引擎(核心,应用内一键完成)

- 菜单「DSH → 检查 DSH 引擎更新…」:对比本地与 npm 上的 `@deepseek-ai/dsh` 版本。
- 有新版则「更新并重启」,执行 `npm install -g @deepseek-ai/dsh@latest` 后自动重启服务。

  命令行等价操作:

  ```bash
  npm run check:dsh    # 仅检查
  npm run update:dsh   # 仅更新(不重启 GUI)
  ```

> 引擎与所有 bundle 都随 `@deepseek-ai/dsh` 包分发(profile 依赖为空),因此
> 更新 CLI 即完成引擎全量更新,无需额外操作。

### 2. DSH Desktop 外壳(自动更新)

外壳通过 [electron-updater](https://www.electron.build/auto-update) + GitHub Releases 实现自动更新:

- **打包版**:启动时静默检查新版本,后台下载,完成后提示「重启安装」。
  菜单「帮助 → 检查应用外壳更新…」可随时手动触发。
- **未签名 / 开发模式**:自动退化为「手动下载」——弹窗引导打开 GitHub Releases 下载页;
  开发模式(源码 checkout)则走 `scripts/update-app.sh`(`git pull + npm install`)。

> ⚠️ macOS 上自动更新要求应用已用 Apple Developer ID 签名并公证。未签名时
> 应用会自动退化为手动下载,不影响其他功能;Windows(NSIS)/Linux(AppImage)可免签名自动更新。

**发布一个新版本(让所有用户自动升级):**

推荐走 CI(GitHub Actions):本地只需提升版本号并打 tag,推送后自动构建发布。

```bash
npm version patch          # 自动改版本号 + git commit + 打 tag vX.Y.Z
git push --follow-tags     # 推送后 CI 自动构建并发布 Release
```

CI 工作流见 [`.github/workflows/release.yml`](.github/workflows/release.yml),触发条件是
推送 `v*` 标签(也可在 Actions 页面手动 `workflow_dispatch`)。

<details>
<summary>本地手动发版(可选,需 GH_TOKEN)</summary>

```bash
# 1) 首次:把 package.json 里两处占位符改成你的仓库
#    - "repository".url
#    - build.publish[0].owner / repo

# 2) 提升版本号并发布
export GH_TOKEN=<你的 GitHub 令牌,需 repo 权限>
npm version patch
npm run release        # 构建 + 上传 GitHub Release + 生成更新源
```

`npm run release` 会执行 `electron-builder --mac --publish always`,自动:
打包 `.dmg`/`.zip` → 上传到 `https://github.com/<owner>/<repo>/releases` → 生成
`latest-mac.yml` 更新清单。已装用户下次启动即自动检测并下载。

</details>

**macOS 签名 + 公证(启用真正自动更新的最后一步):**

本地发版:

```bash
# 签名(Developer ID Application 证书)
export CSC_LINK=/path/to/DeveloperIDApplication.p12
export CSC_KEY_PASSWORD=xxx

# 公证(Apple 账号 + App 专用密码 + Team ID)
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX

npm run release
```

CI 发版:在仓库 Secrets 里配置 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` /
`APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`,然后取消 `.github/workflows/release.yml`
里对应注释并把构建命令换成 `npx electron-builder --mac --publish always -c.mac.notarize.teamId="$APPLE_TEAM_ID"`。

### 自动更新判定逻辑

| 条件 | 结果 |
| --- | --- |
| 打包态 + 已配 GitHub 源 + macOS 已签名 | ✅ electron-updater 自动更新 |
| 打包态 + 已配 GitHub 源 + Windows/Linux | ✅ 自动更新(NSIS/AppImage) |
| 未签名 macOS / 开发模式 / 未配源 | ⬇️ 退化为手动下载 / git pull |

可用环境变量 `DSH_DESKTOP_DISABLE_AUTOUPDATE=1` 强制禁用自动更新(回到手动下载)。

## 配置项(环境变量)

| 变量 | 作用 |
| --- | --- |
| `DSH_BIN` | 强制指定 `dsh` 可执行文件路径 |
| `DSH_DESKTOP_NPM_CACHE` | npm 缓存目录(默认 `~/.cache/dsh-desktop/npm-cache`) |
| `DSH_DESKTOP_REGISTRY` | npm registry(默认官方源) |
| `DSH_DESKTOP_MOCK` | `1` 时用内置 mock 服务器代替真实 `dsh web`(测试用) |
| `DSH_DESKTOP_USER_DATA` | 重定向 userData(日志、Chromium 缓存)目录 |

## 目录结构

```
dsh-desktop/
├── main.js                  # Electron 主进程:服务托管、窗口、菜单、更新流程
├── updater.js               # 无 Electron 依赖的更新核心(版本比较 / npm 操作 / PATH 增强)
├── autoupdate.js            # 应用外壳自动更新(electron-updater + GitHub Releases)
├── mock-server.js           # 冒烟测试用 mock 服务器
├── assets/
│   ├── icon.png             # 应用图标
│   ├── loading.html         # 启动过渡页
│   └── update.html          # 更新进度页
└── scripts/
    ├── generate-icon.js     # 生成图标(纯 Node,无第三方依赖)
    ├── check-dsh.js         # 命令行检查引擎更新
    ├── update-dsh.js        # 命令行更新引擎
    ├── update-app.sh        # 开发模式自更新脚本
    └── release.sh           # 发布到 GitHub Releases(自动更新用)
```

## 说明

- 应用通过解析 `dsh web` 打印的 `dsh web: http://127.0.0.1:<port>` 行定位服务地址,
  因此始终使用系统空闲端口,无端口冲突。
- 从 Finder/桌面双击启动时 PATH 为极简值,应用会主动把 node/npm 所在目录前置到 PATH,
  保证 `dsh`/`npm` 的 shebang 能正确定位到 node。
