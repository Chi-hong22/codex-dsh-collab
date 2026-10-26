# Local connection

The installer creates references/local-settings.json inside the installed skill. It contains a loopback base_url, a runtime_file path, a dedicated token_file path, and the detected python_executable when available. Never commit that generated file or the token.

Use Python 3.10+ from PATH or the detected DSH bundled runtime. Invoke scripts/bridge.py by its absolute installed path. DSH must be open for requests; model authentication remains managed by DSH.

DSH_CODEX_BRIDGE_URL, DSH_CODEX_BRIDGE_RUNTIME_FILE, DSH_CODEX_BRIDGE_TOKEN_FILE, and DSH_CODEX_BRIDGE_TOKEN override the settings. Never print token values. The desktop host binds an OS-assigned port at startup, so scripts/bridge.py uses the baseUrl published in runtime_file (default: runtime.json beside token_file) and falls back to base_url; do not hard-code a port. `install.ps1 -Check` applies the same order and honours `DSH_CODEX_BRIDGE_URL`. Discover current workspace IDs through /workspaces; the installer only authorizes selected registered workspaces.

To configure selected workspaces, rerun install.ps1 -ConfigureOnly with their IDs. For explicitly requested access to all current and future workspaces, use -AllWorkspaces; add -AllowWorkspaceCreate when registration is authorized. This rotates the credential. Do not change permissions for ordinary dispatch.

Plugin source changes require a full Desktop quit/reopen. This bridge shares the desktop runtime; a separate ACP process is not a substitute.
