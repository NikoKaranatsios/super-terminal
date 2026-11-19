# Local operation and recovery

The [README](../README.md) contains installation and keyboard shortcuts. This guide describes the personal macOS installation, not a public hosting deployment.

## Install and run

Requirements are the installed agent CLIs/sign-ins, tmux, Python 3, and a usable Chromium/Chrome executable for browser tools. Building uses the Node/npm versions required in [package.json](../package.json); the installed application has its own Electron/Node runtime.

```sh
npm install
npm run install:desktop
open "$HOME/Applications/Super Terminal.app"
```

Quit Super Terminal before replacing an existing installation. The installer checks that the target is this application and refuses to replace it while running. A successful install leaves the authoritative app in `~/Applications/Super Terminal.app`, moves the replaced app to Trash, and removes the generated build's app copy. It does not permanently erase Trash. Failed replacement or Trash handling can leave an explicit staging/recovery directory; inspect the installer error rather than deleting it blindly. [P1](plans/packaging-and-recovery.md) records the disposable failure/rollback matrix.

Source changes do not change the installed bundle until rebuilt/reinstalled. Documentation-only changes need no rebuild or reinstall. The app is ad hoc signed for personal use, not notarized for public distribution.

## Local files

Default data directory: `~/.super-terminal`, overridden by `SUPER_TERMINAL_DATA`.

| Path | Purpose and retention |
| --- | --- |
| `connections.json` | Private approved SSH names and targets for this installation. |
| `runtime/runtime.json` | Live process identity, credentials, preferences, prompts, and discovery indexes. This is not a work record. |
| `directories.json` | The working directory connected to each environment. Switching environment switches this directory. |
| `<environment directory>/` | Markdown for that environment: README, Conductor conversation, projects, tasks, teams, messages, working sessions, and agent cards. Credentials stay in the data directory. |
| `state.migrated.json` | The previous `state.json` after a successful move into the markdown workspace. Keep it until you have confirmed the workspace. |
| `.pending-<pid>-<uuid>/` | Temporary workspace write. A failed save leaves it in place and does not replace the current files. |
| `context/` | Shared Markdown addressed by stable project/team/agent identity; legacy label-keyed data is not automatically exposed. |
| `agents/` | Private local helper credentials and task outboxes. Stopping enrollment revokes access and removes credentials; pending outbox data is private runtime evidence. |
| `browsers/` | Per-managed-session browser profiles. Profiles can contain cookies and page storage. |
| `screenshots/` | Helper screenshot output on the agent's machine; a repeated screenshot for an ID replaces its image. |
| `coordinator/` | Conductor working directory and transient structured output; completed output files are removed. |
| `desktop/` | Electron user data, including renderer localStorage/workspace preferences. |
| `desktop-window.json` | Saved native window geometry. |
| `desktop-service.log`, `.previous` suffix | Local service diagnostics and one rotated log. This is not an extra app bundle. |

On a remote agent account, `~/.super-terminal/agents/<id>/bridge.py` and `agent-<id>.json` support the reverse tunnel; screenshots are also saved under that account. Provider CLIs keep their own sign-ins and histories in their provider-owned locations. A minimal versioned remote history index persists in state and restores as stale metadata; full remote transcripts remain memory-only. Older running agents can still reference their legacy shared helper path; new launches/reconnects use their own helper.

Do not commit this data or use personal transcripts as test fixtures. A model request through Conductor sends selected work context to the existing Codex account. Process/history discovery and structured task collection make no model calls. Enabled continuous decision rounds send bounded active work context through the existing Codex account. With no eligible work the loop listens without paid idle calls.

## Conflicting state stores

An older installed build can recreate `state.json` after a source build has migrated work into Markdown. The two stores can then contain different projects, teams and conversations. A workspace build refuses to open or save while that legacy file exists alongside the workspace; it does not silently select a winner or merge permissions. The historical `state.migrated.json` backup alone is normal.

Run the read-only inspector from the source checkout:

```sh
npm run recovery:inspect -- "$HOME/.super-terminal"
```

The explicit path avoids an inherited `SUPER_TERMINAL_DATA` override. Without an argument, the command uses that override or the default home directory. It compares the migration backup, legacy state and Markdown workspace by stable record identity, reports one-sided records and differing content/identity categories, and keeps Conductor conversations and memory partitions separate. Its JSON contains counts and hashed references, not IDs, private hostnames, paths, credentials or conversation bodies. Pending receipt counts are occurrences, since the same effect can be recorded in both a turn and the receipt ledger. Missing or malformed inputs and detected changes during inspection fail without writing either store. A fingerprint identifies the observation; it is neither a writer lock nor authorization to apply it later. Preserve any exported report under the project's ignored `.local/` directory.

Preview the supported recovery policy without changing either source:

```sh
npm run recovery:plan -- "$HOME/.super-terminal"
```

This policy retains the active legacy app's project display fields, including empty notes, and keeps alternatives in the recovery archive. It retains unique records, historical conversations and receipts with their original identities. Baseline-only live records remain archived, not revived. Conflicting identities, authority, same-ID conversations/receipts or settings require review. Memories remain separated by environment and recovered Conductor loops are stopped. The plan reports active-turn and uncertain-action blockers; a preview fingerprint alone is not a writer lock.

After the current Conductor turn finishes, use an ordinary external terminal. Quit Super Terminal and any development service; leave agent terminals running. Build and install the guarded current app before applying recovery, and keep it closed until recovery succeeds. The offline command requires a new private archive directory outside all source directories:

```sh
node scripts/recover-workspace.mjs apply "$HOME/.super-terminal" \
  .local/team-recovery/new-archive --keep-current-project-fields
```

The command verifies backups of `state.json`, `state.migrated.json`, `directories.json`, runtime and every environment directory, stages/reopens the candidate, checks for stale sources, and retains rollback evidence. It never sends agent prompts or kills provider processes. Do not run an older app during recovery. If `recovery.lock` remains after a failure, keep the app closed and inspect the private archive's journal and backups. Failed rollback/cleanup requires operator review; deleting the lock or merely renaming `state.json` is not recovery.

For a prepared, reviewed upgrade, [finish-recovery-upgrade.mjs](../scripts/finish-recovery-upgrade.mjs) accepts a private manifest plus `--apply`. It checks source/tool/build identity, refuses an in-flight chat, closes the identified app, installs the guarded build, performs recovery, reopens it, and submits the original activation request once through Conductor. Store the manifest, archive and receipt under the project's ignored `.local/`. An existing receipt prevents blind retry after a partial upgrade or uncertain activation; inspect it and the saved Conductor turn first. This helper is an explicit owner operation, not automatic startup migration. Provider CLI liveness does not prove task acceptance.

## Expected lifecycle

| Operation | Current result |
| --- | --- |
| Close tab/panel/window | Detaches views; tmux/provider work remains. |
| Close all windows on macOS | App/service/watcher continue running. |
| Quit app | Stops an owned service, host browser contexts, and Conductor request; tmux and isolated containers survive. A separately started compatible reused service is left running. |
| Pause/resume agent | Isolated runtimes use Docker pause/unpause. Host mode signals the selected process/foreground job when identifiable and permitted. Shared provider runtimes are protected. |
| Pause/wrap human session | Updates session metadata, not agent processes. |
| Stop/cleanup | Shared lifecycle revokes credentials and attempts owned process/browser/bridge cleanup. Partial remote failures retain a retryable record and never claim confirmed termination. Project files/provider histories remain. |
| Pause/stop Conductor | Stops subsequent continuous rounds and cancels an in-flight autonomous reply. Recorded actions remain; agent processes continue. Loop intent persists. |
| Reboot | Ends processes; persisted app/provider data remains. |

## Troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| Missing-TTY `replace` error | The defensive parsing fix is in `6726db5`/`0.4.1`. Confirm the installed bundle contains the rebuilt version. If it recurs, collect the failing API path and local error stack; do not reset state. |
| Empty/reconnecting initial view | Inspect the local service log and retry/reload. Initial-state retries now restore layout after the first successful state response. A persistent recovery banner retains drafts/layout; bounded readers isolate stalled filesystem work. |
| Port already occupied | Identify whether the listener is a compatible Super Terminal service. Health probing checks product/protocol/data directory and exact runtime build identity. Leave unrelated listeners intact; close only a service you have identified and intend to replace. |
| Owned backend stopped | The app retries its owned service a bounded number of times and exposes persistent recovery feedback. Reused services are left alone. Do not kill tmux to restart the UI. |
| Reload-to-reconnect/API authentication error | The renderer negotiates the fresh token after verifying service identity. Use Try again if recovery remains unavailable; uncertain mutations are not blindly retried. |
| SSH unavailable | Use the named approved connection and existing SSH keys/host-key policy to diagnose access. Cached history may remain, but the app must not show unreachable processes as currently running. |
| SSH ended/local recovery shell | The local transport ended; the remote tmux agent may still be running. Use Reconnect remote on the managed record. It verifies and reattaches the original remote tmux session, restores the helper/tunnel, and does not start another provider. |
| External conversation unavailable | Check whether provider history is readable or ambiguous. The platform cannot reconstruct absent logs or attach arbitrary terminal stdin. Use the original CLI for unsupported history. |
| CLI missing after Finder launch | Check the installed executable/login-shell PATH and provider sign-in. The app imports login-shell PATH and common CLI directories. |
| Browser tool fails to start | Check a supported local Chrome/Chromium executable or `SUPER_TERMINAL_BROWSER`; a configured remote agent still uses the local service's browser executable. |
| No completion banner | Check Activity, the notification setting/test control, and macOS notification/Focus settings. Conductor must select a notification; raw response/exit events alone do not emit banners. The loop must be enabled to make new attention decisions. |
| Unreadable workspace | Preserve `runtime/runtime.json`, the environment markdown, and any `state.migrated.json`. Do not replace them with an empty workspace. Versioned validation rejects malformed data; failed writes retain the previous files and identify the pending directory. |

For a shareable diagnosis, record the application/source version, failing surface, error text with private details removed, source health, and whether unaffected views still work. Keep tokens, private host targets, transcript bodies, and sign-in material out of issues and commits.

Authenticated `/api/diagnostics` returns version/schema, source health categories and resource counts without paths, tokens, targets or conversation bodies. User chat/tasks/profiles and correctness receipts are retained; bounded activity/message/task-event windows are documented in [P3](plans/packaging-and-recovery.md).

## Isolated-team operations

Use **Teams → Runtime availability** to check Docker and prepare the image, or `npm run build:sandbox`. Configure the team and helper allowance through Conductor before starting members. Existing terminals stay in their current execution mode. Provider authentication belongs in the private runtime terminal; do not copy personal homes into images.

**Runtime & browser** links the terminal, browser preview, controls and source commit. `localhost` in that browser is inside the agent container. **Export changes** saves a binary patch through the native file picker; a web-only session uses its browser download. Export temporarily pauses a running container, leaves the real index untouched and resumes it. A failed resume/export is reported as an error. No patch is automatically applied to the host checkout.

Team stop waits for provisioning, cancels older queued launches, revokes platform access and removes owned containers/network services. Agent volumes retain the checkout, private home and browser profile. Stopped agents retain their source export entry. If cleanup is partial, retry **Stop team / Release runtime services**; ownership checks prevent touching another workspace's resources. Never use a global Docker prune to resolve one team's failure.

Reopening a stopped provider conversation is not implemented; its files remain in the retained volume. Docker/runsc availability and provider login failures are reported explicitly. Current source, actual test coverage and unverified environment combinations are in [the isolated-team contract](plans/isolated-teams.md) and [verification](verification.md#isolated-team-runtime-verification). Personal installation still depends on the separate conflicting-store recovery described above.
