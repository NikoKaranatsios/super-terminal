# Verification evidence and remaining checks

Current build: package `0.6.0`, adding Docs, project classification, messaging/focus and project context boundaries. No record implies verification of every personal agent, provider version or SSH environment.

## Docs, coordination and project-boundary evidence (`0.6.0`)

- Full `npm test`: **139 tests passed**. The final frontend assertion pass separately passed all 11 focused tests. Fixtures cover explicit-team-only peers, same-name project separation, scope filtering, queued/read/withdrawn mail, project moves without process termination, stale assignment identity, automatic focus, Docs navigation and live-terminal transport.
- [Project access](../test/project-access.test.mjs), [persistent task provenance](../test/task-provenance.test.mjs) and [Conductor progress](../test/conductor-progress.test.mjs) checks cover foreign target aliases, shared sources retained after agent removal, clean project memory, foreign history reads, sibling reports/team missions, tainted prior replies and replay receipts. These are software-boundary checks, not proof that a provider cannot read files through its operating-system account.
- [Project classification](../test/project-classification.test.mjs) uses synthetic roots, worktrees, symlinks, duplicate names, PID/server reuse and malformed Git metadata. No approved-host SSH or paid model call is needed by the suites.
- Synthetic Docs/agent split previews were visually inspected at 1150×820 and 820×650. Guide tables, topic navigation, project selector and message composer remain usable; details expansion and focus updates survive polling. Personal transcripts are not fixtures.
- `npm run build`, `npm run test:desktop`, packaging, strict deep signature verification and whitespace checks passed. Installed runtime/source/assets match all 44 checked files; the health endpoint reports version `0.6.0`, protocol `2`. All three pre-install managed tmux sessions and managed IDs survived. The generated app copy was consumed by the installer; the previous app is recoverable in Trash.
- The installed app initially stalled during a synchronous filesystem open. A native process sample confirmed `uv_fs_open`/`open`, but did not identify the file. Standalone Node and isolated Electron read-only probes completed normally. The service recovered without a code change: the state endpoint responded in 0.18 seconds with no source warnings and both configured remote scans healthy. **The root cause remains unverified.** Add bounded/isolated filesystem discovery to D1/P2; do not describe recovery as a proven fix.
- Native Docs visual acceptance remains unverified: after launch the window became unavailable to automation and reselecting it timed out. The installed service and fixture renderer were verified separately. Existing provider-launch, notification-banner, and broad native-workspace acceptance items remain open.

## Markdown readability evidence (`0.5.2`)

- Nine [formatter tests](../test/console-format.test.mjs) and the [renderer fixture](../test/work-ui.test.mjs) pass. Coverage includes nested lists, headings, tables, read-only checklists, quotes, marks, syntax highlighting, literal fallbacks, expandable structured replies, markup escaping, URL validation and desktop link dispatch through a fake bridge.
- The synthetic wide split-pane preview was visually inspected. Lists, table cells, a highlighted blocker, JSON syntax colors and an underlined link remain readable. No personal transcript is stored as a fixture.
- Build, whitespace checks and `npm run test:desktop` pass. Dependency installation reported no known audit vulnerabilities. The runtime check does not exercise the native external-browser launch itself.
- Concise-response instructions are configured and reviewed; no paid model call was made to measure adherence or token savings. Responses are not forcibly truncated.
- Installed `0.5.2`, reopened the native Conductor view and visually checked paragraph spacing, bounded reply width, inline code and collapsed structured output. The fixture also verifies expanded details survive incoming progress. All 38 checked runtime/source/asset files match the build, strict deep signature verification passed, and all three pre-install managed tmux sessions survived. No generated app copy remains in release output. Native external-link opening remains unverified.

## Console formatting evidence (`0.5.1`)

- Five [formatter tests](../test/console-format.test.mjs) pass: ANSI colors and resets, text emphasis, indexed/RGB values, escaped markup, ignored terminal side-effect controls, literal code blocks and semantic event tones.
- The [renderer fixture](../test/work-ui.test.mjs) passes with computed color, weight and dimness checks, while retaining session, task, team and output navigation coverage. A wide split-pane layout was visually inspected using synthetic output. No personal transcript was used as a fixture.
- `npm run build` and `git diff --check` pass. This frontend change does not extend the native or provider acceptance claims below.
- Installed `0.5.1`; strict deep signature verification passed and all 36 checked runtime/source/asset files match the build. The health endpoint reports `0.5.1` with protocol `2`; all three pre-install managed tmux sessions survived. The generated app copy was consumed by the installer.
- Native app reopened successfully. Its Conductor pane was visually inspected: green role labels, bright bold emphasis, cyan inline code and subdued metadata render in the existing split workspace. This verifies the console appearance only, not the broader lifecycle, multiwindow or notification acceptance items.

## Feature evidence (`0.5.0`)

| Check | Result and limit |
| --- | --- |
| `npm test` | 80 passing tests, including ten real-backend integration subtests and fixture-renderer coverage. No paid model requests or approved-host SSH scans. Test-owned shells, browsers, state directories and sockets are isolated. |
| `npm run build` / `git diff --check` | Passed. |
| `npm run test:desktop` | Passed: Electron utility runtime, native PTY, protocol-compatible service reuse, shutdown and tmux survival across backend restart. This is not native window/banner acceptance. |
| Scoped continuous coordination | Fake-model tests cover cadence, zero-call idle collection, pause/stop, stale in-flight completion, backoff, narrow scope, usage, traces, duplicate actions and concurrent reports. Policy tests reject conflicting task/team aliases, inactive goals and out-of-scope targets. |
| Tasks and lifecycle | Tests cover migration, legacy goal synchronization, evidence requirements, nested scoped task creation, idempotent replay, stale grants/revisions, helper outboxes, project-root containment, team retries, process identity, credential revocation and partial remote cleanup. |
| Output and interface | Local/remote output parser parity, record-boundary pagination and stable IDs pass. Fixture browser checks cover working-session/process separation, three task layers, teams, chat scope, partial failures, output refresh and recovery. Wide and narrow layouts were inspected using sanitized data. |
| Package/install | Installed `0.5.0`; health reports protocol `2`. All 34 runtime/source/asset files checked match the tested build. Packaging intentionally omits source maps and the lockfile and prunes development package metadata. Strict deep code-signature verification passed. One authoritative app remains in Applications and no generated app bundle remains in release output. |
| Existing terminals | All three managed tmux sessions recorded before replacement remained present after installation. Personal agent lifecycle controls were not exercised for testing. |
| Native UI observation | The installed app opened and its accessibility tree exposed the working-session sidebar, project/team navigation, and saved commentary/tool output with an older-output control. Subsequent navigation was blocked by the automation connection reporting `cgWindowNotFound`, including after reconnect/reset. Full native interaction and banner acceptance remain unverified; the passing runtime/fixture checks do not replace them. |

## Earlier baseline evidence (`0.4.1`)

| Check | Result and limit |
| --- | --- |
| `npm test` | 28 passing tests, including six integration subtests. Uses isolated test state/socket/port and no Conductor model calls or approved-host SSH scans. It still exercises local process/history readers and real test shells/browsers. |
| `npm run test:desktop` | Passed with bundled runtime, native PTY, service reuse/ownership, shutdown, and tmux survival across backend restart. It is a runtime check, not a native window/notification acceptance suite. |
| Build/package/install | Completed; installed source files matched the source build. The successful install left one active app copy and consumed the generated bundle copy. Rollback/failure branches remain unverified. |
| Discovery regression | Before the fix, `/api/state` failed with the reported `replace` error. After installation, it succeeded and both approved SSH scans returned data. The exact original malformed row was not captured. |
| Renderer workspace | Split layout, drag resize, keyboard resize, nested panels, and saved proportions were exercised. Dark styling was inspected in a browser preview. |
| Native app smoke | App opened; Conductor and a live local terminal were visible in a split. Complete extra-window and native notification behavior were not verified. |

Tests are evidence for their actual assertions. For example, shell-based team launches do not establish that every provider accepted its startup prompt; parsing a completion fixture does not demonstrate macOS displayed a banner.

## Automated coverage map

| Test source | What it checks | Material gaps |
| --- | --- | --- |
| [core.test.mjs](../test/core.test.mjs) | Malformed tmux rows/missing TTYs, shell quoting, host validation, atomic state round-trip/malformed state preservation, partial JSONL/tool filtering | Per-source scan health, remote reader parity, nested persisted-state validation |
| [conductor.test.mjs](../test/conductor.test.mjs) | Evidence ID/status validation, deterministic history matching, project/team action results, partial launches, cleanup preservation, selected-process pause/resume/stop, wrap/carry-forward | Real model behavior, scoped project launch location, action retry/cancel ledger, remote lifecycle |
| [work-sessions.test.mjs](../test/work-sessions.test.mjs) | Topic grouping, progress/wrap-up, fresh carry-forward IDs, scope validity | Persistent versus scoped project linkage, consistent evidence validation across routes |
| [workspace.test.mjs](../test/workspace.test.mjs) | Pane/tab identity, focus, split ratios, serialization, invalid-layout fallback | Native windows, renderer failure recovery, focus/clipboard/terminal interactions |
| [activity.test.mjs](../test/activity.test.mjs) | Explicit successful completion markers, old-history baselines, actual log append, outage/paused/exit distinctions, watcher dedup/muting | Native banners/clicks, multiple markers per scan, local scan failure, rotated logs/vanished targets |
| [integration.test.mjs](../test/integration.test.mjs) | Real PTY input/resize/detach, Host/Origin/token rejection, mailbox scopes, browser profile separation/screenshot/control-port block, shell team launches, scoped progress/wrap/carry-forward | Real provider acceptance, SSH bridge recovery, browser races, shared cleanup paths |
| [desktop-runtime.cjs](../test/desktop-runtime.cjs) | Electron utility backend, PTY output, reuse, stop/restart, tmux persistence | Packaged app menus/windows, installer rollback, unexpected backend crash/reconnect |

## Commands and test boundaries

```sh
npm test
npm run build
npm run test:desktop
git diff --check
```

Run the tests relevant to changed behavior, plus required integration/runtime checks when touching those boundaries. `test:desktop` needs built frontend assets and a working desktop runtime. Browser integration requires a usable local browser executable. Missing prerequisites are a blocked check, not a pass.

Use disposable data directories, unused ports, unique tmux sockets, fixture histories, and test-owned processes. Ordinary checks must not stop personal agents, modify provider source histories, or start paid model requests. Intentional live provider/SSH acceptance should use explicit test work and preserve unrelated sessions. Do not publish personal scan output as evidence.

Documentation-only changes require relative-link/anchor checks and `git diff --check`. Do not rebuild or reinstall merely to publish plans.

## Outstanding end-to-end acceptance

These checklists remain unchecked until evidence is recorded; source existence and mocked tests are insufficient.

- [ ] **D1/D2:** Local scan failure, partial remote scan, inaccessible owner, same-folder agents, PID reuse, offline restart, and ambiguous/absent history all produce truthful inventory and matching.
- [ ] **D3/T1:** For Codex, Claude, and Grok in each approved environment where installed, verify launch/resume, original account/cwd, native commands, prompt/role/scope delivery, and readable history. Record unavailable combinations explicitly.
- [ ] **C1/C2:** A chat-only working session can accept broad topics, correct location, add goals, assign agents at every layer, report progress, wrap up, and carry unresolved work. Check a remote scoped project specifically.
- [x] **C3 (fake adapter):** Bounded large-inventory context, multi-round usage, automatic read-only briefing, duplicate proposals, cancellation, and action-limit reporting pass with a fake model adapter before any intentional model smoke check.
- [ ] **T2/T3:** Two managed providers exchange readable scoped messages; reassignment reaches the inbox; bridge/service/SSH recovery preserves the agent; each stop/removal/cleanup path has consistent, verified resource outcomes.
- [ ] **U1:** Native separate windows, simultaneous panes, same-session attachments, menus/shortcuts, pointer/keyboard sizing, clipboard, quit/reopen, and missing-agent restoration work without stopping agents.
- [ ] **U2:** A Conductor-selected notification produces a native alert; clicking works with windows open and closed. Raw response completion and process exit remain Activity data without automatic banners. Verify mute, baseline, outage, missing-target, and duplicate-window behavior.
- [ ] **U3/P2:** Initial state failure, backend replacement/token rotation, unexpected service exit, large history lists, and source warnings recover without losing usable views or drafts.
- [ ] **B1/B2:** Pending browser launch versus cleanup, concurrent commands, popup/close cases, remote screenshot transfer, profile retention, and control-page boundary checks pass without personal browser access.
- [ ] **P1/P3:** Installer failure/rollback and persisted-state migrations pass in disposable fixtures; failure reports identify recoverable artifacts and preserve original data.

## Evidence format

For each completed item, record the source revision, scenario, environment/provider category, command or native interaction, observed result, and remaining limitation. Omit private targets and conversation content. Use pass/fail/unavailable/unverified explicitly. No dates, estimates, deadlines, or delivery horizons are needed.

New focused suites: [continuous loop](../test/conductor-loop.test.mjs), [action scope](../test/conductor-policy.test.mjs), [helper outbox](../test/bridge.test.mjs), [tasks](../test/tasks.test.mjs), [lifecycle](../test/lifecycle.test.mjs), [provider output](../test/transcript.test.mjs), [view projection](../test/work-views.test.mjs), and [fixture renderer](../test/work-ui.test.mjs). These use synthetic examples, not personal transcripts.
