# app-launcher-mcp

应用启动器 MCP server：让 AI 助手（如 Reasonix / Claude / 任何支持 MCP 的工具）按名称或路径**打开 Windows 上的任意软件**——包括 Halcon、CC Switch、Codex、X-AnyLabeling、浏览器、文件管理器等。

## 工具

| 工具 | 说明 | 参数 |
| --- | --- | --- |
| `launch_app` | 启动软件 | `app`（必填：注册名/别名/完整路径）、`args`（可选启动参数）、`cwd`（可选工作目录） |
| `list_apps` | 查看已注册软件清单 | 无 |

## 已注册软件（apps.json）

| 名称 | 别名 | 启动内容 |
| --- | --- | --- |
| `halcon` | hdevelop、halcon软件 | HDevelop（MVTec Halcon 18.11） |
| `halconxl` | — | HDevelop XL |
| `ccswitch` | cc-switch | CC Switch（Claude Code 配置切换） |
| `codex` | codex-cli | OpenAI Codex |
| `xanylabeling` | anylabeling、标注 | X-AnyLabeling 标注工具（conda 环境 kkk） |
| `edge` | 浏览器 | Microsoft Edge |
| `notepad` | 记事本 | 记事本 |
| `calc` | 计算器 | 计算器 |
| `mspaint` | 画图 | 画图 |
| `explorer` | 文件管理器 | 文件资源管理器（用户主目录） |
| `cmd` | 命令行、终端 | CMD 命令行 |

## 一、安装

```bash
npm install        # 安装依赖（首次）
node src/index.js  # 手动启动（MCP 客户端会自动拉起，一般无需手动运行）
```

## 二、注册为 MCP

以 Reasonix 为例（全局注册，本机所有项目可用）：

1. 确保 `.mcp.json` 中的路径正确（默认指向本目录 `src/index.js`）
2. 使用 `install_source` 工具，source 指向 `app-launcher/.mcp.json`，scope=global
3. **重启 Reasonix** 使注册生效

其他支持 MCP 的工具（Claude Desktop、Cursor 等）：在其 MCP 配置中添加 stdio server，命令为 `node <本目录绝对路径>\src\index.js`。

## 三、使用示例

注册完成后，直接对 AI 说：

```
打开 halcon
打开标注工具          # 按别名 xanylabeling
打开 D:\项目 这个文件夹  # 直接传路径
用记事本打开 C:\Users\me\1.txt   # 传路径 + 参数
```

AI 会自动调用 `launch_app` 完成启动。

## 四、添加新软件

编辑 `apps.json`，追加一项：

```json
"photoshop": {
  "name": "Photoshop",
  "path": "C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe",
  "aliases": ["ps", "修图"]
}
```

- `path`：可执行文件绝对路径、Windows 自带命令（如 `notepad`）、或 .bat/.lnk
- `aliases`：可选，方便按中文/缩写调用
- `type`：可选，`folder` 表示用文件资源管理器打开目录；缺省按程序处理

## 五、特殊应用：conda 环境软件（如 X-AnyLabeling）

conda 环境里安装的 GUI 软件（如 `xanylabeling`）直接启动会因缺少环境变量失败。解决方式：
写一个启动 bat（如 `start-xanylabeling.bat`），激活环境后启动：

```bat
@echo off
call C:\Users\12579\miniconda3\Scripts\activate.bat kkk
start "" "C:\Users\12579\miniconda3\envs\kkk\Scripts\xanylabeling.exe"
```

然后在 `apps.json` 里把 `path` 指向该 bat。

> ⚠️ 注意：conda GUI 应用（Python + PyQt）**启动很慢**，可能需要 30–90 秒才弹出窗口，属正常现象。

## 六、技术原理（重要）

Windows 下 Node.js 启动的子进程默认位于 **Job Object** 中，父进程（MCP server）退出时，直接 `spawn` 的 GUI 软件会被**连带终止**（软件一闪就没）。

本项目采用 **schtasks（任务计划程序）** 方案解决：

```
launch_app → 创建一次性计划任务 → /run 立即执行 → 删除任务定义
```

由 Task Scheduler 服务派生的进程**完全脱离** Node 进程树，即使 Reasonix / MCP server 退出，软件依然独立运行。

## 七、开发与测试

```bash
npm test    # 冒烟测试：连接 server，验证 list_apps 与启动 notepad
```

## 项目结构

```
src/index.js              # MCP server：launch_app / list_apps
apps.json                 # 软件注册表（名称/别名/路径/类型）
start-xanylabeling.bat    # conda 环境应用启动器示例
.mcp.json                 # MCP 注册描述
test/smoke.mjs            # 冒烟测试
```
