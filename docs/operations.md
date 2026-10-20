# Local operation and recovery

The [README](../README.md) contains installation and keyboard shortcuts. This guide describes the personal macOS installation, not a public hosting deployment.

## Install and run

Requirements are the installed agent CLIs/sign-ins, tmux, Python 3, and a usable Chromium/Chrome executable for browser tools. Building uses the Node/npm versions required in [package.json](../package.json); the installed application has its own Electron/Node runtime.

```sh
npm install
npm run install:desktop
open "$HOME/Applications/Super Terminal.app"
```

Quit Super Terminal before replacing an existing installation. The installer checks that the target is this application and refuses to replace it while running. A successful install leaves the authoritative app in `~/Applications/Super Terminal.app`, moves the replaced app to Trash, and removes the generated build's app copy. It does not permanently erase Trash. Failed replacement or Trash handling can leave an explicit staging/recovery directory; inspect the installer error rather than deleting it blindly. [P1](plans/packaging-and-recovery.md) documents outstanding failure tests.

Source changes do not change the installed bundle until rebuilt/reinstalled. Documentation-only changes need no rebuild or reinstall. The app is ad hoc signed for personal use, not notarized for public distribution.

## Local files

Default data directory: `~/.super-terminal`, overridden by `SUPER_TERMINAL_DATA`.

| Path | Purpose and retention |
| --- | --- |
| `connections.json` | Private approved SSH names/targets. Only Local, 157, and Romagnolo 91 are intended for this installation. |
| `state.json` | Managed records/tokens, teams, mail, project/session/goal metadata, prompts/preferences, Conductor chat/memory/assessments, and activity. Preserve this file during troubleshooting. |
| `state.json.tmp` | Temporary replacement during saves, not a second installed version. |
| `context/` | Group shared Markdown, addressed by a hash of group name. |
| `agents/` | Private local helper credential files. Their cleanup lifecycle is tracked in T3. |
| `browsers/` | Per-managed-session browser profiles. Profiles can contain cookies and page storage. |
| `screenshots/` | Helper screenshot output on the agent's machine; a repeated screenshot for an ID replaces its image. |
| `coordinator/` | Conductor working directory and transient structured output; completed output files are removed. |
| `desktop/` | Electron user data, including renderer localStorage/workspace preferences. |
| `desktop-window.json` | Saved native window geometry. |
| `desktop-service.log`, `.previous` suffix | Local service diagnostics and one rotated log. This is not an extra app bundle. |

On a remote agent account, `~/.super-terminal/bridge.py` and `agent-<id>.json` support the reverse tunnel; screenshots are also saved under that account. Provider CLIs keep their own sign-ins and histories in their provider-owned locations. Remote history indexes/transcripts are currently in-memory caches in the local service; a service restart loses that offline cache.

Do not commit this data or use personal transcripts as test fixtures. A model request through Conductor sends selected work context to the existing Codex account. Process/history discovery itself makes no model calls.

## Expected lifecycle

| Operation | Current result |
| --- | --- |
| Close tab/panel/window | Detaches views; tmux/provider work remains. |
| Close all windows on macOS | App/service/watcher continue running. |
| Quit app | Stops an owned service, browser contexts, and Conductor request; tmux survives. A separately started compatible reused service is left running. |
| Pause/resume agent | Conductor signals the selected process/foreground job when identifiable and permitted. Shared provider runtimes are protected. |
| Pause/wrap human session | Updates session metadata, not agent processes. |
| Stop/cleanup | Current paths differ for remote transport, browser, token, and artifacts; see [T3](plans/teams-and-agent-lifecycle.md). Cleanup does not erase provider conversations or project files. |
| Reboot | Ends processes; persisted app/provider data remains. |

## Troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| Missing-TTY `replace` error | The defensive parsing fix is in `6726db5`/`0.4.1`. Confirm the installed bundle contains the rebuilt version. If it recurs, collect the failing API path and local error stack; do not reset state. |
| Empty/reconnecting initial view | Inspect the local service log and retry/reload. Initial-state retries now restore layout after the first successful state response. D1/U3 cover remaining failure isolation. |
| Port already occupied | Identify whether the listener is a compatible Super Terminal service. Health probing checks product/protocol/data directory. Leave unrelated listeners intact; close only a service you have identified and intend to replace. |
| Owned backend stopped | Use the app's restart action. tmux work should remain; do not kill tmux to restart the UI. |
| Reload-to-reconnect/API authentication error | Reload the view to obtain the current per-start token. Automatic renderer token recovery remains in P2/U3. |
| SSH unavailable | Use the named approved connection and existing SSH keys/host-key policy to diagnose access. Cached history may remain, but the app must not show unreachable processes as currently running. |
| SSH ended/local recovery shell | The local transport ended; the remote tmux agent may still be running. Select its discovered remote pane rather than assuming it stopped. Attaching the pane does not currently rebuild its helper tunnel automatically. |
| External conversation unavailable | Check whether provider history is readable or ambiguous. The platform cannot reconstruct absent logs or attach arbitrary terminal stdin. Use the original CLI for unsupported history. |
| CLI missing after Finder launch | Check the installed executable/login-shell PATH and provider sign-in. The app imports login-shell PATH and common CLI directories. |
| Browser tool fails to start | Check a supported local Chrome/Chromium executable or `SUPER_TERMINAL_BROWSER`; a configured remote agent still uses the local service's browser executable. |
| No completion banner | Check Activity, the notification setting/test control, and macOS notification/Focus settings. A successful response marker or actual exit is required; idle/running is not completion. |
| Unreadable state | Preserve `state.json` and inspect the specific parse/validation error. Do not overwrite it with an empty state. Nested validation/migration improvements are tracked in P3. |

For a shareable diagnosis, record the application/source version, failing surface, error text with private details removed, source health, and whether unaffected views still work. Keep tokens, private host targets, transcript bodies, and sign-in material out of issues and commits.
