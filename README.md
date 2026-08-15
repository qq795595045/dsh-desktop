# DSH Desktop

将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web 界面(`dsh web`)
封装为原生桌面应用:以 Electron 外壳托管 `dsh web` 服务,并提供内置的引擎更新与自更新能力。

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

### 2. DSH Desktop 外壳

- **开发模式(源码 checkout)**:菜单「帮助 → 更新应用外壳」执行
  `scripts/update-app.sh`(`git pull --ff-only && npm install`)。首次需先建立 git 仓库并配置远程:

  ```bash
  git init
  git remote add origin <你的仓库地址>
  git add -A && git commit -m "DSH Desktop" && git push -u origin main
  ```

- **打包版**:下载最新 `.zip`/`.dmg` 覆盖安装即可(菜单内会给出提示)。
  如需自动更新,可在后续接入 [electron-updater](https://www.electron.build/auto-update)
  并配置发布源(如 GitHub Releases)。

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
├── mock-server.js           # 冒烟测试用 mock 服务器
├── assets/
│   ├── icon.png             # 应用图标
│   ├── loading.html         # 启动过渡页
│   └── update.html          # 更新进度页
└── scripts/
    ├── generate-icon.js     # 生成图标(纯 Node,无第三方依赖)
    ├── check-dsh.js         # 命令行检查引擎更新
    ├── update-dsh.js        # 命令行更新引擎
    └── update-app.sh        # 开发模式自更新脚本
```

## 说明

- 应用通过解析 `dsh web` 打印的 `dsh web: http://127.0.0.1:<port>` 行定位服务地址,
  因此始终使用系统空闲端口,无端口冲突。
- 从 Finder/桌面双击启动时 PATH 为极简值,应用会主动把 node/npm 所在目录前置到 PATH,
  保证 `dsh`/`npm` 的 shebang 能正确定位到 node。
