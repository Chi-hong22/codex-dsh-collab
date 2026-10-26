# Codex ↔ DSH Collaboration

[中文说明](README.zh-CN.md) · [Bridge protocol](PROTOCOL.md) · [AI index](llms.txt)

Codex delegates tasks to a local DeepSeek Harness (DSH) workspace through an authenticated loopback HTTP bridge, waits for the run, reads the transcript, and continues the conversation. The repository ships a DSH plugin and the `$deepseek-harness` Codex skill that talks to it.

| Part | Role |
| --- | --- |
| `@esroamer/codex-dsh-collab` (DSH plugin) | Serves the `/codex-bridge` routes, authenticates tokens, publishes the runtime address. |
| `$deepseek-harness` (Codex skill) | Codex-side client: resolves the bridge, dispatches tasks, waits for runs, reads transcripts. |
| [PROTOCOL.md](PROTOCOL.md) | Client-independent HTTP and JSON contract. |

Both parts are required. Adding only the plugin leaves Codex without a client that can call it.

## What it does

- Codex creates a task in a DSH workspace. DSH executes it with its own tools and approvals. Codex waits, reads the transcript, appends instructions, and closes the task when the work is done.
- Access is scoped per workspace, or explicitly to all current and future workspaces. Registering a new workspace is a separate permission.
- Sessions, transcripts, and task records live in DSH, where you can watch or take over the session as usual.
- Codex starts every interaction. DSH never wakes an idle Codex session.

Other agent applications can implement [PROTOCOL.md](PROTOCOL.md) to drive the same bridge. This repository ships and tests the Codex client; other clients need their own adaptation.

## Requirements

- Windows, DSH Desktop, and Codex.
- Node.js 22+ and Python 3.10+ for the setup script and the Codex client.

## Install

### 1. Add the DSH plugin

In DSH, open **Settings → Plugins → Add plugin** and enter `https://github.com/Chi-hong22/codex-dsh-collab`, a local checkout, or `@esroamer/codex-dsh-collab`.

The current release is 0.3.0. All-workspace scope and workspace registration require 0.2.0 or later; automatic bridge address discovery requires 0.3.0 or later.

### 2. Configure the Codex client

Clone this repository, then run from its root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ConfigureOnly
```

The script installs the `$deepseek-harness` skill, creates a token for the workspace you select, and writes `local-settings.json` next to the installed skill.

### 3. Check the connection

If DSH was already running before step 1, restart it first. Then run:

```powershell
.\install.ps1 -Check
```

A healthy check reports the bridge protocol version and the DSH process ID.

### 4. Use it in Codex

Invoke `$deepseek-harness` and describe the task and the target workspace.

For all current and future workspaces, plus permission to register new ones:

```powershell
.\install.ps1 -ConfigureOnly -AllWorkspaces -AllowWorkspaceCreate
```

Codex registers a project directory only when DSH has no workspace for that path. It reuses an existing workspace and never creates directories.

To let the script manage the plugin installation as well, exit DSH completely and run `install.ps1` without `-ConfigureOnly`.

## Why the bridge port changes

DSH Desktop starts its web server with `--port 0`, so Windows assigns a free port on every launch (1024–15000 in the default dynamic range). The real port exists only once the socket is listening, and it changes again on the next launch. An address captured at install time goes stale, and calls to the old port fail because nothing is listening there.

Since 0.3.0 the plugin publishes the live address to `runtime.json`, by default `~/.dsh/codex-bridge/runtime.json`:

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

Clients resolve the address in this order:

1. `DSH_CODEX_BRIDGE_URL`, when set. This disables discovery.
2. The published `runtime.json`.
3. The `base_url` in `local-settings.json`, as a fallback.

Do not pin a port in configuration. The desktop rewrites `runtime.json` on every start, so a restarted DSH is picked up without editing files.

## Troubleshooting

### A call fails with `Cannot reach the bridge; tried ...`

Every candidate address failed. The message lists each URL with its socket error, such as `[WinError 10061] No connection could be made`. Check, in order:

1. Is DSH Desktop running?
2. Does the plugin appear under Settings → Plugins, and is it 0.3.0 or later?
3. Does `~/.dsh/codex-bridge/runtime.json` exist, and is its `baseUrl` port actually listening? `Get-NetTCPConnection -LocalPort <port>` shows this.
4. Run `.\install.ps1 -Check`; it repeats these checks with short timeouts.

Restarting DSH rewrites `runtime.json` when the plugin is current.

### Calls worked before a DSH restart, then failed

The client is using an address from the previous run. Common causes: the plugin is older than 0.3.0, or `DSH_CODEX_BRIDGE_URL` pins a port. Update the plugin, rerun `.\install.ps1 -ConfigureOnly` to write `runtime_file`, then restart DSH and Codex. If that environment variable is set, remove it or point it at the new address.

### The bridge returns HTTP 401 or 403

The token does not cover the requested workspace. Rerun `-ConfigureOnly` to authorize the current workspace; add `-AllWorkspaces` to cover all workspaces, and `-AllowWorkspaceCreate` to register new ones.

### DSH `pwsh` returns 3221225794 without output

This is a DSH runtime problem with Windows shell startup, not a bridge problem. See the [Windows shell startup case](skills/deepseek-harness/references/windows-shell-startup.md).

## Security

- The bridge listens on the loopback address only (`--host 127.0.0.1`), and clients send a bearer token created by the installer.
- Codex client requests ignore system HTTP proxies and reject redirects.
- Access is limited to the selected workspaces, or to all workspaces when explicitly authorized. Workspace creation is a separate permission.
- DSH tool approvals stay in effect; the plugin does not auto-approve tool calls.
- `runtime.json` and token files are written with user-only permissions.

## Documentation

- [PROTOCOL.md](PROTOCOL.md): routes, request and response shapes, error format.
- [skills/deepseek-harness/SKILL.md](skills/deepseek-harness/SKILL.md): how Codex calls the client.
- [local-setup.md](skills/deepseek-harness/references/local-setup.md): environment variables, `runtime.json`, local files.
- [operations.md](skills/deepseek-harness/references/operations.md): operational constraints.
- [windows-shell-startup.md](skills/deepseek-harness/references/windows-shell-startup.md): the `3221225794` case.
- [llms.txt](llms.txt): project index for AI search and retrieval.

### Common questions

- **Does DSH wake an idle Codex session?** No. Everything starts from Codex; DSH only answers and executes.
- **Where are the files?** By default under `~/.dsh/codex-bridge/`: `runtime.json`, `tokens.json`, `state.json`, and the token file. The installer manifest is `~/.dsh/codex-bridge-install/installation.json`.
- **Can another agent application use the bridge?** Yes, by implementing [PROTOCOL.md](PROTOCOL.md). Only the Codex client is tested in this repository.

## Upstream and license

This project is a fork of [ESROAMER/codex-dsh-collab](https://github.com/ESROAMER/codex-dsh-collab). The upstream repository is the original project; this fork adds runtime address publishing and discovery for the bridge, together with the fixes described above. Report fork issues at [Chi-hong22/codex-dsh-collab/issues](https://github.com/Chi-hong22/codex-dsh-collab/issues). Licensed under MIT.
