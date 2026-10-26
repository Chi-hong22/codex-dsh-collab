# Codex–DSH 协作插件

[English](README.md) · [桥接协议](PROTOCOL.md) · [AI 索引](llms.txt)

Codex 通过本机回环认证桥，把任务交给 DeepSeek Harness Desktop（DSH）工作区，等待执行、回读转写，再接着对话。仓库包含一个 DSH 插件和配套的 `$deepseek-harness` Codex 技能。

npm 包名为 `@esroamer/codex-dsh-collab`，桥模块名为 `dsh-codex-bridge`。

| 组成 | 作用 |
| --- | --- |
| `@esroamer/codex-dsh-collab`（DSH 插件） | 提供 `/codex-bridge` 路由，校验令牌，发布运行时地址。 |
| `$deepseek-harness`（Codex 技能） | Codex 侧客户端：解析桥地址、派发任务、等待执行、回读消息。 |
| [PROTOCOL.md](PROTOCOL.md) | 与客户端无关的 HTTP/JSON 协议。 |

两部分都要装：只加插件，Codex 侧没有可调用的客户端。

## 能做什么

- Codex 在 DSH 工作区里创建任务，DSH 用自身的工具和审批执行；Codex 等待、回读转写、追加指令，完成后关闭任务。
- 权限按工作区授予，也可显式授权全部现有和未来工作区。注册新工作区是另一项独立权限。
- 会话、转写和任务记录都在 DSH 中，可以在 Desktop 照常查看或接管。
- 每次交互由 Codex 发起，DSH 不会唤醒空闲的 Codex 会话。

其他 agent 软件可按 [PROTOCOL.md](PROTOCOL.md) 接入同一个桥。本仓库附带并测试的是 Codex 客户端，其他客户端需要自行适配。

## 环境要求

- Windows、DSH Desktop 和 Codex。
- 安装脚本与 Codex 客户端需要 Node.js 22+ 和 Python 3.10+。

## 安装

### 1. 在 DSH 中添加插件

在 DSH 中打开 **设置 → 插件 → 添加插件**，输入 `https://github.com/Chi-hong22/codex-dsh-collab`、本地目录或 npm 包名 `@esroamer/codex-dsh-collab`。

当前版本为 0.3.0。全部工作区和工作区注册需要 0.2.0 或更高版本；自动发现桥地址需要 0.3.0 或更高版本。

### 2. 配置 Codex 客户端

克隆本仓库，在根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ConfigureOnly
```

脚本会安装 `$deepseek-harness` 技能，为你选择的工作区创建令牌，并在已安装技能目录写入 `local-settings.json`。

### 3. 检查连接

如果第 1 步之前 DSH 已在运行，先重启它，然后运行：

```powershell
.\install.ps1 -Check
```

连接正常时会输出版本协议号和 DSH 进程 PID。

### 4. 在 Codex 中使用

调用 `$deepseek-harness`，说明任务和目标工作区。

授权全部现有与未来工作区，并允许注册新工作区：

```powershell
.\install.ps1 -ConfigureOnly -AllWorkspaces -AllowWorkspaceCreate
```

Codex 仅在 DSH 没有该路径的工作区时注册目录；已有工作区直接复用，不会创建目录。

若要让脚本一并管理插件安装，请完全退出 DSH，在仓库根目录运行不带 `-ConfigureOnly` 的 `install.ps1`。

## 桥地址为什么会变

DSH Desktop 用 `--port 0` 启动 Web 服务，Windows 每次启动都会分配一个空闲端口（默认动态范围 1024–15000）。真实端口要等 socket 开始监听才确定，下次启动又会变。安装时写下的地址因此会过期，调用会打到无人监听的端口。

0.3.0 起，插件把实际地址写入 `runtime.json`，默认位于 `~/.dsh/codex-bridge/runtime.json`：

```json
{
  "version": 1,
  "baseUrl": "http://127.0.0.1:54321/codex-bridge",
  "port": 54321,
  "prefix": "/codex-bridge",
  "pid": 12345,
  "startedAt": "2026-10-26T09:00:00.000Z"
}
```

客户端按以下顺序解析地址：

1. 设置了 `DSH_CODEX_BRIDGE_URL` 时只用它，不再自动发现。
2. 已发布的 `runtime.json`。
3. `local-settings.json` 中的 `base_url`，仅作回退。

不要在配置里固定端口。桌面每次启动都会重写 `runtime.json`，重启后无需改文件。

## 故障排查

### 报 `Cannot reach the bridge; tried ...`

所有候选地址都不可用。消息会逐个列出 URL 和套接字错误，例如 `[WinError 10061] No connection could be made`。按顺序检查：

1. DSH Desktop 是否在运行？
2. 设置 → 插件中是否存在本插件，版本是否 0.3.0 或更高？
3. `~/.dsh/codex-bridge/runtime.json` 是否存在，其中 `baseUrl` 的端口是否有进程监听？可用 `Get-NetTCPConnection -LocalPort <port>` 确认。
4. 运行 `.\install.ps1 -Check`，它会用较短超时做同样的检查。

插件版本正确时，重启 DSH 会重写 `runtime.json`。

### 之前能用，DSH 重启后调用失败

客户端还在用上一次运行留下的地址。常见原因是插件低于 0.3.0，或环境变量 `DSH_CODEX_BRIDGE_URL` 固定了端口。升级插件后重跑 `.\install.ps1 -ConfigureOnly` 写入 `runtime_file`，再重启 DSH 和 Codex；如果设置过该环境变量，删除它或改成新地址。

### 桥返回 HTTP 401 或 403

令牌不覆盖请求的工作区。重跑 `-ConfigureOnly` 为当前工作区授权；需要全部工作区时加 `-AllWorkspaces`，需要注册新工作区时再加 `-AllowWorkspaceCreate`。

### DSH 的 `pwsh` 无输出并返回 3221225794

这是 DSH 运行时的 Windows 终端启动问题，与桥接无关。见 [Windows shell 启动案例](skills/deepseek-harness/references/windows-shell-startup.md)。

## 安全

- 桥只监听回环地址（`--host 127.0.0.1`），客户端以 Bearer 头携带安装脚本生成的令牌。
- Codex 客户端请求忽略系统 HTTP 代理，并拒绝重定向。
- 访问范围限于所选工作区，或显式授权后的全部工作区。创建工作区是独立权限。
- DSH 工具审批继续生效，插件不会自动批准工具调用。
- `runtime.json` 与令牌文件以仅当前用户可读写的权限写入。

## 文档

- [PROTOCOL.md](PROTOCOL.md)：路由、请求与响应形状、错误格式。
- [skills/deepseek-harness/SKILL.md](skills/deepseek-harness/SKILL.md)：Codex 的调用方式。
- [local-setup.md](skills/deepseek-harness/references/local-setup.md)：环境变量、`runtime.json` 与本地文件。
- [operations.md](skills/deepseek-harness/references/operations.md)：运行约束与注意事项。
- [windows-shell-startup.md](skills/deepseek-harness/references/windows-shell-startup.md)：`3221225794` 的排查记录。
- [llms.txt](llms.txt)：面向 AI 检索的项目索引。

## 常见问题

### 怎样把 Codex 接到 DeepSeek Harness Desktop？

在 设置 → 插件 中添加本插件，克隆本仓库后运行 `install.ps1 -ConfigureOnly`，重启 DSH，再运行 `install.ps1 -Check`；之后在 Codex 中调用 `$deepseek-harness`。见 [安装](#安装)。

### 为什么 DSH 每次重启后桥端口都会变？

DSH Desktop 用 `--port 0` 启动 Web 服务，Windows 每次启动都会分配新的空闲端口。0.3.0 起插件把实际地址写入 `runtime.json`，客户端先读它，读不到再回退到配置的 `base_url`。见 [桥地址为什么会变](#桥地址为什么会变)。

### 重启后 Codex 报 “Cannot reach the bridge” 怎么办？

客户端多半还在用上一次的端口。把插件升级到 0.3.0 或更高，重跑 `-ConfigureOnly` 让 `local-settings.json` 写入 `runtime_file`，重启 DSH 后重试。见 [故障排查](#故障排查)。

### 这是 MCP 服务器吗？

不是。它是一个本机认证的 HTTP/JSON 桥，协议见 [PROTOCOL.md](PROTOCOL.md)。任何能发 HTTP 请求的 agent 软件都可以实现客户端。

### 支持 macOS 或 Linux 吗？

安装脚本和 Codex 技能只在 Windows 上验证过；桥本身是回环 HTTP 服务，不依赖 Windows。

### DSH 会主动唤醒 Codex 吗？

不会。所有交互由 Codex 发起，DSH 只应答和执行。

### 文件放在哪里？

默认在 `~/.dsh/codex-bridge/` 下：`runtime.json`、`tokens.json`、`state.json` 和令牌文件。安装清单位于 `~/.dsh/codex-bridge-install/installation.json`。

### 其他 agent 软件能用吗？

可以，按 [PROTOCOL.md](PROTOCOL.md) 实现即可；本仓库目前只验证了 Codex 客户端。

## 上游与许可

本项目 fork 自 [ESROAMER/codex-dsh-collab](https://github.com/ESROAMER/codex-dsh-collab)，上游是原始项目；本 fork 增加了桥运行时地址的发布与发现，以及上文所述的修复。fork 的问题请提到 [Chi-hong22/codex-dsh-collab/issues](https://github.com/Chi-hong22/codex-dsh-collab/issues)。采用 MIT 许可证。
