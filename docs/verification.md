# Verification

Current source build: package `0.11.0`. The release candidate passes all **300 tests** and builds successfully. Its runtime build identity matches both the installed macOS bundle and the running desktop service. The public source snapshot excludes private workspace records and generated bundles. Earlier sections below retain the evidence and limits of their individual builds; later installation evidence supersedes their historical pending-installation notes. No result certifies every personal agent, provider owner or future CLI version.

## Public source and project page

The `0.11.0` release packages the installed graph workspace source and the buildless [project page](../website/README.md). Publication uses a reviewed source manifest from the existing workspace, retaining private local reports separately. The source scan checks known private paths/targets, credential patterns and generated artifacts. It does not confer a project license.

The interactive website uses invented content and performs no provider or shell requests. The [website fixture](../test/website.test.mjs) passes **12 checks including its parent test and optional axe run** under the production CSP. It covers question/reply transitions and counts, preserved per-session drafts, view-only limits, search/filters, parent/worktree scenarios, dragging without accidental opening, pan/zoom/Fit, keyboard selection and terminal focus, literal text handling, reset, installation copy and denied-clipboard fallback, FAQ disclosure, IDs/fragments, and no-JavaScript installation content. Wide and 320/390/768/1024px layouts have no page overflow; selected nodes remain reachable through the jump control and canvas navigation. Desktop/mobile screenshots were reviewed.

Axe-core reports zero tested WCAG A/AA violations for wide/narrow and filtered/unfiltered states. This is not full accessibility certification. The fixture reports no external requests or script/CSP errors. These website checks do not certify the desktop app; see the separate canvas and native-runtime evidence below.

Public asset checks exposed cached CSS/JavaScript from the prior page. Content-hashed query strings now select the matching assets; the browser fixture checks those hashes against file bytes. Deployment verification fetches the exact stylesheet/script URLs in public HTML in addition to comparing all six files at the origin.

## Isolated-team runtime verification

This source extension implements the owner-selected [isolated-team contract](plans/isolated-teams.md). The starting working tree already contained other changes; its 265-test baseline passed and was preserved before this work. The installed personal app and conflicting legacy/Markdown stores were left unchanged. No commit, push, personal provider login or model call was made for these checks.

| Layer | Actual evidence and limits |
| --- | --- |
| Source | `npm test`: **276 passed, zero skipped**. [Runtime policy/delegation tests](../test/sandbox.test.mjs) cover grant validation, inherited scope, duplicate/concurrent requests, capacity/depth/launch bounds, stale assignments, uncertain recovery, private-address rejection, resource ownership, capacity reservation after unconfirmed stops, and graph lineage. [Export tests](../test/runtime-export.test.mjs) cover cancellation, private atomic saving and preservation on failure. Build-identity tests include Dockerfile, seccomp and runner changes. |
| Real local Docker | `scripts/test-sandbox.mjs`: **11 checks passed** using Docker 29.8.0 and the built `super-terminal-agent:1` image. Actual private committed-source checkouts, preserved host WIP, nonroot/read-only/volume-only execution, denied direct internet, allowed/denied proxy destinations, credential-free scoped transport, Chromium with its sandbox enabled, separate homes, controller restart, pause/resume, index-preserving export and retained workspaces after stop. |
| Real service/API | `scripts/test-sandbox-api.mjs`: **6 checks passed**. Owner grant/launch, real agent-spool helper request with inherited scope and deduplication, depth denial, authenticated Docker PTY, restart continuity, denied active grant changes, retained records/volumes, and stop during provisioning. The race check also verifies that an older queued role cannot restart a stopped team. |
| Runtime UI | [Fixture test](../test/runtime-ui.test.mjs) passed: lineage/limits, browser errors, preserved URL input, paused controls, graph navigation and draft-only Conductor configuration. Wide and 800/400/320 CSS-pixel layouts passed overflow checks. Axe-core 4.14.0 reported **zero tested A/AA violations** on Teams and Runtime; this is not full accessibility or VoiceOver certification. |
| Native runtime UI | `npm run test:sandbox:native`: **5 checks passed** in actual Electron and Docker. Runtime navigation, terminal input starting a preview server, actual in-container Chromium screenshot, native export bridge, pause/resume, 800×500 window at 150% zoom, and quit/reopen with the same running container/preview. Screenshots were visually inspected. The save-dialog result is controlled to select a disposable fixture path; native OS file-picker interaction is not claimed. |
| Persistence and cleanup | Disposable repositories, app/provider homes, ports and Docker owner labels. Test cleanup checks ownership and removes only fixture resources. Normal app quit keeps containers. Team stop removes containers/network services, retaining volumes; export works without applying changes to the original repository. |
| Build and desktop regression | Frontend/image builds and `test:desktop` pass. Exact-build service recovery, PTY/token rotation and tmux survival remain verified separately from native window/provider behavior. The existing native harness also passed output, clipboard, multiple windows, layout/draft restoration and process survival. It observed a fullscreen event; minimize was not confirmed, and notifications returned an OS permission error. |

Commands:

```sh
npm run build
npm run build:sandbox
npm test
npm run test:sandbox
npm run test:sandbox:native
npm run test:desktop
npm run test:native
```

The runtime source and container image include Codex/Claude, but these checks use shell agents. Authenticated provider startup, login destinations, interactive approval flows, SSH Docker and gVisor remain **unverified**. Grok requires a compatible owner-selected image. Limits apply to platform-managed helpers and container CPU/memory/processes, not provider billing, provider-internal workers or volume disk usage. Stopped provider files remain retained, but conversation reopening is not implemented. Personal installation depends on the separate state recovery workflow; this is not an installed-release claim.

## Conflicting state-store verification

The offline recovery and activation-preparation changes pass **265 tests**, with no skips. [Recovery application tests](../test/workspace-reconcile.test.mjs) cover byte-preserving backups, candidate reopen, original roster/credential/history retention, current-project-field policy, environment separation, active/uncertain blockers, stale sources, lock enforcement, partial replacement rollback, failed rollback and symlink refusal. [Upgrade tests](../test/recovery-upgrade.test.mjs) verify exact manifest requirements, original-request-only submission through owner chat, durable uncertain outcomes and truthful per-role process reporting. The [existing-team dispatch test](../test/conductor-dispatch.test.mjs) confirms that a fresh project invocation receives its saved four-role roster without another project's content.

A private isolated copy of the conflicting personal stores was recovered and reopened successfully; the copy simulated completion of the current running turn to exercise offline application. No live store was changed. This rehearsal verifies record retention under that condition, not current-chat completion, actual installation, provider login or acceptance. Full finisher execution and live team activation remain pending.

Build, 42 focused recovery/dispatch checks, isolated desktop runtime and native Electron checks pass. Runtime checks cover exact-build service reuse, owned-service recovery, fresh tokens and tmux survival. Native checks cover the existing graph/workspace navigation, output, clipboard, PTY, same-session windows, draft/layout restoration and quit survival; fullscreen was confirmed and minimize was not. The native notification test still reports an OS permission rejection, so banner delivery is not verified. These checks used disposable state, provider homes, sockets and ports, not the personal team.

The [recovery inspection tests](../test/workspace-recovery.test.mjs) cover read-only comparison, retained source bytes, same-ID content and authority differences, missing records, legacy consolidation evidence, remote conversation separation, nested pending receipts, invalid inputs, changing sources and CLI rejection of apply arguments. The inspector is a source command; no live recovery, app replacement or team activation is established by these tests.

With the inspector added, `npm test` passes **248 tests**, with no skips. The 16 focused recovery/state tests, syntax checks, documentation links and whitespace checks pass. No new build or native desktop check was needed for this standalone inspection command; the installed runtime is unchanged.

Two new [state regressions](../test/state-schema.test.mjs) first reproduced silent omission of newer legacy conversations and unguarded saves, then passed with the safeguard in [the workspace store](../server/markdown-store.mjs). They cover valid and unreadable recreated legacy files, normal roster migration/reopen, and conflicting legacy writes after opening new, saved and migrated workspaces. Rejected operations preserve every existing fixture file byte for byte, including the migration backup, and diagnostics exclude conversation contents.

At the earlier safeguard checkpoint, `npm test` passed **239 tests**, with no skips. The 12 focused state/core checks, `npm run build`, `npm run test:desktop` and whitespace checks passed. The isolated desktop check verified backend recovery and tmux survival; no new native window or notification acceptance was claimed. The running personal installation and its work records were not changed. Divergent-store reconciliation and installation remain pending; the safeguard reports the conflict and does not merge records.

## System graph verification

The source graph implementation passes **237 tests** with `npm test`, with no skipped tests. [Graph projection tests](../test/system-graph.test.mjs) verify environment separation, unknown/enrolled process state, task/process distinctions, scoped transport metadata, message direction/delivery, partial action receipts, per-round trace coalescing and disclosed inventory limits. [Browser tests](../test/system-graph-ui.test.mjs) verify live updates, preserved focus/expanded prompts, safe prompt rendering, navigation into live and saved conversations, MCP details, filtering, zoom, narrow layouts, source disconnection and recovery. The existing UI review now includes the graph among its twelve screens. No new axe run was performed in this pass.

The real stdio MCP integration suite passes the new `st_conductor` call, safe request telemetry, scoped graph, explicit-team messaging, durable retry/restart behavior and revocation. These checks use synthetic projects and no model calls. Initial prompt capture is implemented at the managed launch boundary; this does not assert that every installed provider accepted that prompt. Old and external agents retain explicit prompt gaps.

`npm run build`, `npm run test:desktop` and the isolated `npm run test:native` pass. The native harness selects the graph, inspects a test-owned shell and MCP node, reaches the inspector at 800×500, opens the shell through the graph, then verifies real PTY input, separate-window attachment, quit/reopen and tmux survival. Native notification delivery still reports an OS rejection; minimize/fullscreen were not verified in this run. The first native bootstrap failed because minimal legacy state omitted `projects`; a null-safe migration count and a real store-reopen regression fix that compatibility issue without losing the original migration backup or conversation.

Private screenshots and logs stay under `.local/graph-review/`. Packaging excludes `.local/` and `.worktrees/`. The graph is built from observed inventory and bounded source records; it cannot expose unavailable logs, uncaptured historical prompts, hidden model reasoning, or prove task completion from a live process. Installation into the currently running personal app remains pending; the installer requires it to quit before replacement.

## UI review evidence (`0.7.2`)

`npm test` passes **221 tests** in the current source tree. The UI fixture covers eleven screens at 1280×850, 800×500, 640×425, 400×250 and 320×568 CSS pixels. Axe-core 4.14.0 reports zero tested WCAG A/AA violations on the eleven wide layouts after fixing invalid tablist children and shortcut contrast. The three UI review tests also pass against the separately staged release source, including prompt/agent/team draft retention, failed saves, filter focus across polling, scoped recipients, keyboard tabs, navigation trapping and immediate composer focus.

The isolated native Electron harness passes minimum sizing, actual 200% zoom and navigation, composer focus, clipboard, live PTY input, two windows attached to the same session, menu actions, keyboard divider resizing, draft/layout restoration and tmux survival across quit/reopen. Fullscreen was confirmed in this run; minimize was not. The OS notification test again reports `UNErrorDomain error 1`, so banner delivery remains unverified. These checks do not certify screen-reader behavior, every provider or overall WCAG conformance. [UI review](ui-review.md) records the changes and boundaries.

The UI release is staged from the installed cleanup baseline with the reviewed frontend changes. Unfinished MCP/enrollment backend work remains in the repository and is not included in this app update. Full source tests and staged runtime checks therefore have distinct scopes. The installed and running `0.7.2` app matches the staged runtime files and exact build identity. Strict deep signature verification passes. All eight pre-install tmux session/server identities survived; the generated bundle was consumed and the previous app remains recoverable in Trash. Native UI inspection confirms the revised header/sidebar and readable team conversation with its message composer focused.

## Cleanup and history evidence (`0.7.1`)

`npm test` passed all **208 tests**. New regressions cover inactive project history, scoped search, older message paging, direct chat retrieval across restart, mixed-source exclusion, input-budget retention, historical root aliases, duplicate discovery prevention, consolidation refusal when assignments exist, descriptive titles, shell/service separation and searchable 40-row sidebar pages. Integration teardown explicitly removes its isolated tmux server. These are model-adapter, API and browser-fixture checks; they do not establish model compliance or every provider history format.

Native Electron checks passed after correcting minimum-window sidebar spacing. Output, clipboard, draft restoration, PTY continuity and session survival passed; notification banners remained unavailable because macOS returned a permission error. Two additional provider-process regressions cover Claude service wrappers and exact native-session identity.

The final cleanup release was assembled separately from concurrent, unfinished MCP/enrollment source changes. It preserves those working-tree changes without bundling them. The running app and installed runtime files match the staged cleanup build; this does **not** assert that the installed app matches the entire current working tree. Strict deep signature verification passed. All six recorded pre-install tmux session/server identities and both managed records survived.

Twenty-one focused checks passed for the final provider identity/history/reconciliation/view code. The subsequent overview update passed all seven view/renderer checks, including collapsed projects without tasks or detected agents, folder labels and expansion across polling. The staged release renderer was checked separately. Native runtime/window checks above remain the evidence for process and window behavior; no new provider model call was used to validate history retrieval.

The validated owner endpoints were exercised on the intended empty duplicate and moved locations. Native UI inspection confirmed one canonical project, recovered task squares, folder labels, a collapsed Other projects section and separate collapsed services/terminals. Personal project names, paths, task IDs and transcripts stay in the private workspace cleanup report, outside this repository.

## Conversation, reliability and feature evidence (`0.7.0`)

| Layer | Observed result and limit |
| --- | --- |
| Independent UX reviews | Output, navigation and scrolling reviewers repeated their reviews after fixes and found no remaining required changes in their scope. Chromium probes covered reading anchors, hidden panes, disclosure expansion, font/resize changes and asynchronous xterm output. |
| Native Electron windows | Isolated state, provider homes, service port and tmux socket. Markdown/copy, actual native clipboard, minimum 800×500 window with expanded settings and multiline draft, visible pinned final line, live PTY input, two windows attached to one process, menu handlers, keyboard divider and quit/reopen draft/layout/pin restoration passed. Wide/minimum synthetic screenshots were inspected. |
| OS acceptance | Native focus could not be established; minimize/fullscreen requests were not confirmed. The notification test returned macOS `UNErrorDomain error 1`, displayed accurately in the UI. This verifies failure reporting, not visible banner delivery or native clicks. These checks remain unavailable/unverified, not passed. |
| Owned service | Actual isolated Electron utility-process kill caused bounded replacement, fresh-token recovery and preserved tmux. Exact-build/protocol/data reuse, clean shutdown, reused-service ownership and restart tests passed. Build identity includes runtime Python helpers, action JSON and model instructions as well as JS/assets. |
| Discovery/history | Controlled stalled child reader verifies parent responsiveness, timeout and replacement. Tests cover incomplete/failed source health, unknown retained evidence, no false exits, wrapper-shell SSH descendants, missing-PID races, PID/server/owner reuse, malformed optional metadata, durable stale minimal remote indexes and parser/history matching. The earlier installed OS-open stall was not reproduced; the reader boundary limits its impact, not a proven root-cause diagnosis. |
| State/installer | Nested shape/version validation, repeat-safe migration, unknown-field preservation, malformed/future-state rejection, flushed atomic replacement/write failure and redacted diagnostics pass. Fifteen disposable installer cases cover preflight, copy, replacement, rollback, Trash and output cleanup. Existing private state validated read-only before release. |
| Scoped work/actions | Clean owner-intent creation excludes global context and restricts creation references; shared project/location mutations, delayed-selection race, bulk per-target outcomes, wrap/carry-forward attribution and missing/conflicting evidence pass. A started-receipt snapshot/restart test refuses blind replay of uncertain effects. Scope, usage, cancellation and action-limit regressions remain passing. These are deterministic adapter/integration checks, not a broad real-model workflow claim. |
| Browser | Per-agent queues and pending-close/page recovery fixtures pass. Actual Chromium verifies separate profiles/cookies, screenshots, direct URL/scheme rejection, multi-hop redirect handling, popup navigation/close recovery and control WebSocket rejection. A final integration check found that routing alone misses redirect hops; forced browser request marking and server-side bootstrap rejection now cover them. Profiles remain retained; this is not an OS/filesystem sandbox. |
| Notifications/recovery UI | Outcome/watcher/target fixtures cover show/failure/unconfirmed/unavailable, mute/baselines/restarts, latest-marker coalescing, missing targets and shared watcher deduplication. Renderer transitions preserve drafts/layout/settings during initial failure/token replacement; missing views remain understandable. A synthetic 5,000-history list remained usable at roughly 60 ms rendering after state arrival; this is one fixture measurement. |
| Approved SSH environments | `test:environments` passed on both configured SSH environments, using disposable remote directories and test-owned local/remote tmux sessions. It exercised cwd/preflight, shell persistence, scoped context, mailbox fetch/explicit acknowledgment, actual local-browser PNG transfer to the remote account, deliberate transport loss, reconnect to the original remote tmux session without duplication, revoked credentials and exact owned helper cleanup. |

### Provider observations

| Location/account category | Installed capabilities observed | Execution evidence / limits |
| --- | --- | --- |
| Local | Codex `0.163.0`, Claude `2.1.292`, Grok `1.0.62`; tmux `3.8`, Python `3.15.0` | Authenticated headless marker replies passed for all three. Codex used a disposable home with copied auth only and ephemeral/read-only/tools-disabled execution. Claude used its existing native login with tools and session persistence disabled; an isolated config reported no login. Grok used a disposable home/auth and unique leader socket with tools/web/subagents disabled. This is not interactive TUI/slash-command or resume acceptance. |
| First configured SSH account | Codex, tmux, and Python were available; Claude and Grok were not on PATH | Actual managed shell/helper/reconnect/screenshot checks passed. Native Codex help supports the shared launch/resume arguments; authenticated interactive new/resume and other owners remain unverified. |
| Second configured SSH account | Codex, tmux, and Python were available; Claude and Grok were not on PATH | Same remote shell/helper checks passed. Full provider/account acceptance remains unverified. |

An earlier isolated Conductor skill/file-write/read-back smoke remains evidence for direct execution and native skill invocation (see `0.6.1` below). It does not establish every installed plugin or model. Provider permissions were not changed by the launch adapter.

### Final release checks

`npm test` passed all **200 tests** after the final fixes. Build, exact-build Electron crash/restart checks, native UI harness and both approved-environment checks passed within the scopes above. Strict deep signing and package-content checks passed. Installed and reopened the authoritative `0.7.0` app: all **60** checked runtime/source/assets match; exact runtime build identity matches; health reports `0.7.0` / protocol `2`; the state API responds with no source warnings and both approved remote scans healthy. All **four** pre-install tmux session/server identities survived. The previous app is recoverable in Trash and the generated bundle was consumed. No source commit or push was made in this pass. Native and remote acceptance use only disposable app state/sockets/directories. Private targets, auth and personal transcripts are excluded from repository evidence.

The redirect handling follows [Playwright's redirect semantics](https://playwright.dev/docs/network#redirects): request routing sees the initial hop, while explicitly supplied continuation headers persist through redirects. The service rejects the nonsecret browser marker before serving bootstrap or API content; real redirect/popup tests verify the result.

## Conductor runtime evidence (`0.6.1`)

- [Runtime tests](../test/conductor-runtime.test.mjs) cover independent session settings, validation, persistence, no-session chat, frozen per-turn configuration, native CLI arguments, local/remote cwd handling and catalog responses without exposing private configuration.
- One intentional local provider smoke used a disposable project and skill with `gpt-6.1-sol` at low reasoning. Conductor read the skill, ran four commands, wrote the requested uppercase file, read it back, and returned a successful structured reply. The temporary project and state were removed. This verifies direct local file/skill execution, not all plugin integrations or remote providers.
- All **144 tests passed** with `node --test --test-concurrency=1 test/*.test.mjs`. The parallel run encountered a fixture polling timeout; the fixture also passed independently. `npm run build`, `npm run test:desktop`, packaging, strict deep signature verification and `git diff --check` passed. Wide, narrow and expanded settings fixture screenshots were inspected. Native window automation timed out, so native interaction with these controls remains unverified.
- Installed `0.6.1` and reopened the authoritative app. Its health endpoint reports `0.6.1`; all 47 checked runtime/source/asset files match, all three pre-install managed sessions remain present, and the generated bundle was consumed. Installed catalog discovery returns the configured CLI model and enabled skills without errors. An initial health probe timed out, then the service recovered without another code change; the existing startup-stall cause remains unresolved.

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

| Sources | Assertions |
| --- | --- |
| [Formatter](../test/console-format.test.mjs), [following](../test/output-follow.test.mjs), [fixture UI](../test/work-ui.test.mjs) | Readable safe output, keyed updates, partial results, anchors/pinning, navigation/settings/drafts, source/token recovery and large fixture lists |
| [Runtime settings](../test/conductor-runtime.test.mjs), [owner intent](../test/owner-intent.test.mjs), [Conductor loop](../test/conductor-loop.test.mjs), [policy](../test/conductor-policy.test.mjs) | Frozen per-session settings, clean creation, bounded usage/actions, uncertainty recovery and scope boundaries |
| [Reader](../test/bounded-reader.test.mjs), [classification](../test/project-classification.test.mjs), [remote index](../test/remote-index.test.mjs), [transcripts](../test/transcript.test.mjs) | Deadlines/source failure, stable identity, offline metadata, matched histories and record-boundary parser parity |
| [Preflight](../test/launch-preflight.test.mjs), [provider commands](../test/provider-commands.test.mjs), [lifecycle](../test/lifecycle.test.mjs), [reconnect](../test/remote-reconnect.test.mjs) | Native launch arguments, prerequisites, identity revalidation, partial outcomes and existing-agent bridge recovery |
| [Integration](../test/integration.test.mjs), [browser](../test/browsers.test.mjs), [bridge](../test/bridge.test.mjs), [tasks](../test/tasks.test.mjs) | Real PTY/profile/redirect boundaries, mailbox acknowledgment, teams/task evidence and cleanup |
| [State](../test/state-schema.test.mjs), [installer](../test/installer.test.mjs), [backend](../test/backend.test.mjs) | Recoverable persistence/install failures, exact service compatibility and ownership |
| [Activity](../test/activity.test.mjs), [target resolution](../test/notification-target.test.mjs) | Coalescing/baselines/outages/mute, watcher outcomes and useful unavailable targets |
| [Desktop runtime](../test/desktop-runtime.cjs), [native UI harness](../scripts/test-native-ui.mjs), [approved environments](../scripts/test-approved-environments.mjs) | Separate actual runtime/window and approved SSH acceptance described above |

## Commands and test boundaries

```sh
npm test
npm run build
npm run test:desktop
npm run test:native
# Opt-in actual SSH, only the private approved allowlist:
npm run test:environments
git diff --check
```

Run the tests relevant to changed behavior, plus required integration/runtime checks when touching those boundaries. `test:desktop` needs built frontend assets and a working desktop runtime. Browser integration requires a usable local browser executable. Missing prerequisites are a blocked check, not a pass.

Use disposable data directories, unused ports, unique tmux sockets, fixture histories, and test-owned processes. Ordinary checks must not stop personal agents, modify provider source histories, or start paid model requests. Intentional live provider/SSH acceptance should use explicit test work and preserve unrelated sessions. Do not publish personal scan output as evidence.

Documentation-only changes require relative-link/anchor checks and `git diff --check`. Do not rebuild or reinstall merely to publish plans.

## Remaining acceptance limits

- **D3/T1:** Full interactive new/resume/native commands, startup prompt/role delivery and history for each installed provider/owner. Missing remote Claude/Grok and isolated Claude login are recorded above; headless replies and shell launches are not substitutes.
- **C1–C3:** A broad authenticated chat-only session/project/task workflow and extended provider execution beyond the local capability/marker smoke. Deterministic clean-context/action/restart checks pass.
- **U1:** OS focus/minimize/fullscreen, physical shortcut dispatch and exhaustive remote multi-client resizing. Available native window/clipboard/output/menu-handler/restoration checks pass.
- **U2:** Visible native banners and clicking with windows open/closed. The isolated native test observed an OS rejection; failure reporting and target resolution pass.

All implemented remedies, constraints and optional extensions remain in [the implementation record](implementation.md). Unavailable checks are not hidden by marking the entire matrix complete.

## Evidence format

For each completed item, record the source revision, scenario, environment/provider category, command or native interaction, observed result, and remaining limitation. Omit private targets and conversation content. Use pass/fail/unavailable/unverified explicitly. No dates, estimates, deadlines, or delivery horizons are needed.

New focused suites: [continuous loop](../test/conductor-loop.test.mjs), [action scope](../test/conductor-policy.test.mjs), [helper outbox](../test/bridge.test.mjs), [tasks](../test/tasks.test.mjs), [lifecycle](../test/lifecycle.test.mjs), [provider output](../test/transcript.test.mjs), [view projection](../test/work-views.test.mjs), and [fixture renderer](../test/work-ui.test.mjs). These use synthetic examples, not personal transcripts.

## Sessions workspace verification

The 0.8.0 session workspace has focused tests for all-environment discovery, project/model search, live versus unverified counts, provider-recorded model changes, old/current Codex index schemas, missing model files, and history identity guards. UI fixtures verify direct xterm keystrokes (including Enter and Ctrl+C), no session composer or implicit mailbox prompt, stable keyboard focus across polling/tab changes, view-only external sessions, secondary navigation, cancelable terminal creation and constrained layouts.

Isolated native Electron acceptance passed for live PTY input, same-session attachment in a second window, terminal focus, clipboard, minimum sizing, saved drafts/layout, keyboard resizing, app quit and session survival. Desktop runtime acceptance passed for bundled Node/SQLite, native PTY, exact-build service reuse, service crash recovery, token rotation and clean shutdown. Notification delivery was rejected by the test environment (UNErrorDomain 1); it is not claimed as verified. Full-screen transitions passed; a programmatic minimize request did not report a minimized window.

The integration suite additionally covers an untracked pane on the app tmux server: it appears in inventory with a distinct socket-qualified identity, accepts native keyboard input, and survives detachment. No existing personal agent is stopped or restarted by these tests. Source, package and installed acceptance remain separately recorded below.

### Installed sessions workspace

- All **282 tests pass** on the final source; the production frontend build passes and `git diff --check` is clean.
- The packaged, installed and running **0.8.0** runtime has the same verified build identity. Deep strict code-signature verification passes. The installer consumed its generated bundle and keeps the replaced app recoverable in Trash, with one app in Applications.
- Offline recovery retained 8 stored session records, 220 projects, 18 tasks, 2 teams, 3 working sessions and 66 conversation turns. All source records and alternate project fields are retained in the private recovery archive. Recovery launched no agents and kept coordination loops stopped.
- All **31 checked local process identities** and **23 local tmux pane/server/process identities** survived the update. Both configured remote discovery sources returned healthy inventories. The first complete updated inventory contained 83 detected live sessions, 69 with terminal transport, and recorded models for 32 of 39 provider sessions. Counts can change as processes start, exit or become unverified.
- Native inspection of the installed app confirms Sessions navigation, provider/model columns, direct terminal views, collapsed More navigation, and the All environments filter. An intermittent source remains explicitly unverified rather than counted as running.
- Existing terminals outside supported tmux sockets remain view only. A provider's recorded model is evidence from its index or last readable output, not a guarantee of its next turn's routing. No personal transcript or connection configuration is included in committed fixtures.

Private source snapshots, test logs, process-preservation records, build identities and the recovery archive live under `.local/live-sessions-improvement/` and are excluded from version control.

## Agent graph workspace verification

The 0.9.0 implementation makes the graph the main workspace, with exact-session adjacent terminal attachment and no extra composer. Projection/browser fixtures cover root/worktree grouping, model/branch search, environment separation, process/activity distinctions, keyboard traversal, attention and completion filters, retained parent context, saved child output, polling focus, reload and narrow layouts. Provider observation fixtures cover structured questions, asynchronous acknowledgment, user answers, explicit completion, stale evidence and JavaScript/Python parity. Git fixtures cover outside worktrees, nested repositories, preserved enrolled authority and differing remote shell/agent directories.

The isolated native harness verifies clicking a graph node opens and reuses an adjacent terminal, focuses native input, accepts actual PTY keystrokes and preserves the process through separate windows and app restart. Native notification permission and minimize acceptance remain separate from the graph. Private screenshots, inventory checks and test logs live under `.local/session-graph-improvement/`, excluded from version control. The full suite passed **293 tests**, with no failures or skips. The final folding refinement passed all **8 focused graph/signal tests**, including a new large-family projection case and browser expansion/focus checks. Build, isolated desktop runtime, native Electron acceptance and strict deep signature verification passed.

### Installed agent graph

The 0.9.0 installation reported **0.9.0**; the current installation is recorded below. Source, installed runtime and live service build identities match; the generated release copy was consumed. Native inspection confirms the primary graph, activity filters, worktree labels, saved-child distinctions and subagent expansion controls. Both configured remote inventories and local discovery returned healthy results. All 42 observed worktree sessions had canonical project groups.

The checked inventory contained 38 detected agents plus 211 linked saved children. Default folding reduced this to 41 visible nodes; search and state filters retain matching children and parent context. These are changing runtime counts, not fixture expectations or universal discovery claims.

All **23 checked local tmux pane/server/process identities** and the managed record IDs survived both replacements. All 20 sampled other local process identities were present after the first replacement; 19 remained at the final check. One external Codex process ended between observations; the cause was not established. No personal agent lifecycle commands were issued. Native notification banner permission and minimize remain unverified; fullscreen succeeded in the isolated native run.

Activity is provider/report evidence, not direct knowledge of task progress. Explicit input requests differ from questions detected in reply text. Unsupported prompts, unlogged activity, absent parent metadata and stale observations remain unknown. Native saved children without their own terminal remain view only. Claude indexing includes up to 200 child files per parent and Codex’s unarchived index remains bounded; this is not universal subagent enumeration.

## Rich agent graph layout verification

Build **0.10.0** replaced the fixed-height, left-gutter layout with full-width project sections and responsive columns of connected agent families. [Layout code](../src/session-graph-layout.mjs) measures natural card heights, retains stable columns across task-title/content updates and follows visible geometry for arrow-key navigation. [Card rendering](../src/session-graph.mjs) and [styles](../src/session-graph.css) expose the current task, full question/activity text, model, checkout, directory, observation age and separate process/evidence source. Recorded task counts have a segmented bar. More detail expands reports, next steps, exact observation time and model evidence without opening a terminal.

The full regression suite passed **299 tests**, with zero failures or skips. All **13 focused graph/signal/layout checks** passed before that run. The final narrow-pane refinement passed all **5 layout checks** again. [Layout fixtures](../test/session-graph-layout.test.mjs) cover 80 agents, multiple projects, measured/expanded heights, stable columns, cyclic parent input, widths from 240 to 2200 CSS pixels, spatial keyboard navigation, full question/model/path wrapping, preserved disclosure focus and details that cannot launch or prompt agents. The 800×500 split-pane check confirms controls leave usable canvas space and cards fit the pane.

The isolated native Electron harness passed graph-to-terminal navigation, reuse, real PTY input, separate windows, clipboard, restoration and quit survival. The isolated desktop runtime passed exact-build reuse, owned-service recovery, token rotation and tmux survival. These use disposable sessions, ports and state. Native notification delivery still returned an OS permission rejection; minimize remains unverified and fullscreen succeeded. The final responsive refinement was checked in browser fixtures; installed native visual inspection confirms project columns and readable model/checkout/directory/activity fields with the actual inventory. No new full accessibility audit is claimed.

The 0.10.0 installation at `~/Applications/Super Terminal.app` reported **0.10.0**. Source, installed runtime and live service build identities match, strict deep signature verification passed, and the generated release app was consumed. All **23 checked local tmux pane/server/process identities**, all **19 sampled other local process identities**, and all **8 managed record IDs** survived this replacement. Local and both configured remote inventories were healthy. Private baselines, screenshots and logs remain under `.local/graph-richness/`, excluded from version control.

Activity and model labels retain their existing evidence limits. The progress bar counts recorded task states; it does not estimate completion from a running process. Saved child output remains distinct from live terminals, and absent relationships or provider activity remain unknown.

## Agent node canvas verification

Installed **0.11.0** replaces the card board with a node canvas. [Layout](../src/session-graph-layout.mjs) builds a deterministic left-to-right forest; projects and parent agents connect through curved ports, and subagent links are dashed. [Rendering and interaction](../src/session-graph.mjs) support saved node positions, drag/click separation, pointer/trackpad panning, cursor-anchored zoom, minimap navigation, Fit, 100%, Tidy up and keyboard traversal that reveals offscreen nodes. Position changes are display-only and scoped to the data workspace. [Styles](../src/session-graph.css) use compact provider tiles and textual/color activity indicators, with working-edge animation disabled by reduced-motion preferences. Full questions, paths, evidence age and task progress remain available in the inspector. Single clicks open existing terminal/output views alongside; no new composer or agent launch is introduced.

All **300 tests passed**, with no failures or skips. The **14 focused graph/signal/canvas tests** also passed. [Canvas tests](../test/session-graph-layout.test.mjs) cover an 80-agent forest, non-overlapping automatic positions, bounded cyclic input, negative drag coordinates, stable topology under resizing/title changes, saved position restoration, Tidy up, pan/zoom/minimap changes, complete Fit bounds, readable initial zoom, offscreen keyboard focus, full inspector evidence, narrow panes and navigation without session creation/prompt requests. Existing [graph tests](../test/session-graph.test.mjs) retain worktree grouping, activity filters, known parents, saved-child folding, polling focus and adjacent terminal behavior.

The isolated native Electron harness passed node-to-terminal attachment and reuse, actual PTY input, separate windows, clipboard, restoration and quit survival. The isolated desktop runtime passed exact-build reuse, owned-service recovery, fresh tokens and tmux survival. Native notifications still reported the existing OS permission rejection; minimize remains unverified and fullscreen succeeded. Synthetic visual captures under `.local/graph-canvas/` show the canvas, inspector and split layouts. Installed native accessibility inspection confirms canvas controls, minimap, provider/state labels, subagent details and an adjacent live terminal. A final native screenshot attempt timed out in the inspection tool; it is not recorded as a successful visual capture.

The authoritative app reports **0.11.0**. Source, installed runtime and live service build identities match; strict deep signature verification passed and the generated release app was consumed. All **23 checked local tmux pane/server/process identities**, all **19 sampled other local process identities**, and all **8 managed record IDs** survived the replacement. Local and both configured remote inventories were healthy. Private baselines and logs remain in `.local/graph-canvas/`, excluded from version control. No personal agent lifecycle commands or test prompts were issued.

The graph retains the existing evidence limits: status describes reported/observed activity, task counts do not estimate completion, and saved children without terminal transport remain view only. Layout and visual connections do not alter authority or create new execution relationships.
