# Super Terminal implementation

This is the implementation record for build `0.7.0`, covering the requested features, independent UX reviews and acceptance work. Work is ordered by dependency and completion criteria, with no delivery dates or estimates. The detailed subsystem plans remain the supporting specifications. Previously implemented Conductor execution, skills and per-session model selection are retained.

## Isolated-team source extension

The owner selected container execution and managed helpers. The [isolated-team contract](plans/isolated-teams.md) records implemented runtime boundaries, private browsers, inherited delegation limits, runtime UI, retained-work export and remaining provider/SSH/runsc acceptance. [Verification](verification.md#isolated-team-runtime-verification) records actual checks. This extension is in source and does not replace the installed personal app or reconcile its state stores.

## Completion rules

- **Open** means implementation or verification is still required. **In progress** names the current work. **Implemented / verification pending** means code and relevant automated checks pass but an explicitly required live check remains. **Complete** requires the named acceptance evidence. **Unavailable** records a concrete environmental limitation; it never means the feature passed.
- Implement one coherent change, run its relevant checks, review the result, and correct findings before moving to the next dependency. Record code, tests and material limits here and in [verification](verification.md).
- Preserve running agents, provider histories, project boundaries, existing CLI permissions, and the single authoritative installed app. Use disposable fixtures for destructive and lifecycle checks.
- Review the conversation experience independently for output, navigation and scrolling. Repeat the reviews against the implemented result. Do not declare completion based on an uninspected screenshot or a mocked native interaction.

## Ordered implementation queue

| ID | Work and dependency | Completion criteria | State |
| --- | --- | --- | --- |
| UX1 | Conversation output; independent readability review | Conductor and saved assistant replies render readable Markdown; one final answer per turn; tools and structured payloads remain inspectable without dominating the conversation; material failures stay visible. Native CLI rendering remains native. | Complete: formatter, Chromium and native Electron checks; reviewer approved |
| UX2 | Follow latest output; independent scrolling review | Default follow, explicit lock-to-bottom option, paused reading position, visible jump/new-output control, resize/hidden-pane recovery, and anchored earlier-history loading pass browser checks. | Complete: browser/xterm and native pin/resize/restoration checks; reviewer approved |
| UX3 | Navigation and controls; independent usability review | The default workspace makes the primary chat obvious, session/settings context is clear, primary actions are easy to find, controls work at minimum size, and drafts survive failed sends and reconnects. | Complete: fixture and minimum-size native checks; reviewer approved |
| P1 | Installer recovery | Disposable tests cover missing build, unrelated/running app, copy/replacement/rollback/Trash/output-cleanup failures. A failure preserves a usable bundle and identifies recovery artifacts. | Complete: 15 disposable fixtures and verified installed release |
| P3 | Versioned persisted state and diagnostics | Repeat-safe migration and nested validation preserve valid legacy data; malformed input and failed writes preserve original files; technical record retention is explicit; diagnostics omit credentials and conversation bodies. | Complete: migration/write/diagnostics fixtures and integration |
| P2 | Build compatibility and owned-service recovery; P1/P3 | Reuse requires compatible build/API/data identity. An owned service can recover without killing tmux; unknown/reused services are not stopped. Renderer/watcher authentication recovers. | Complete: exact identity and actual owned-service crash recovery |
| D1 | Bounded discovery and truthful source health; P3 | A stalled filesystem reader cannot block the service; partial failures preserve usable evidence and cannot create false exits; healthy empty results, PID reuse, owner identity and protected runtimes are tested. | Complete: stalled-reader, source health and identity checks; approved SSH flows |
| D2 | History coverage and offline indexes; D1/P3 | Versioned minimal remote indexes survive restart as stale metadata; missing/ambiguous/inaccessible history is explicit; resume reuses matched live work or explains why it cannot attach. No full remote transcripts are persisted. | Complete: offline-index, history and resume-reconciliation checks |
| D3 | Provider compatibility and isolated reader fixtures | Centralized arguments/markers where needed; tests use fixture provider homes; installed provider/owner combinations have explicit pass/failure/unavailable records with native permissions preserved. | Implemented; local authenticated replies pass; full interactive matrix unverified |
| T1 | Launch preflight/readiness and partial team recovery; D3 | Missing prerequisites fail before credentials/resources leak; transport, provider readiness and recovery shell are distinct; successful team members survive retries without duplicate roles; remote persistence is explicit. | Implemented; preflight/team fixtures and actual remote shell launches pass; provider matrix unverified |
| T3 | Consistent lifecycle and resource ownership; D1/T1 | Pause/stop/remove/cleanup share identity validation, credential revocation, browser/bridge cleanup and per-target partial results. Provider histories and project files are never removed. | Complete for owned lifecycle contract: local integration, identity and both approved remote cleanup flows |
| T2 | Mailbox acknowledgment and bridge recovery; P3/T1/T3 | Queued, fetched and explicit acknowledgment are distinct; assignment handoffs are attributable; reconnect restores the managed remote helper without another provider launch or public control-port exposure. | Complete: scoped acknowledgment fixtures and both approved remote reconnect flows |
| C1 | Safe chat creation and complete project/session actions; P3/T2 | A clean owner-intent flow creates sessions/projects without global-context leakage; project topics/locations and goals can be edited; assignment/carry-forward references remain valid; remote paths are handled remotely. | Complete: clean owner-intent/action/API/UI fixtures; broad real-model workflow remains unverified |
| C2 | Wrap-up evidence and explicit bulk process control; C1/T3/D2 | Summaries retain conflicting/missing evidence and attribution; session pause/wrap leaves processes alone; an explicit bulk request reports each target's result and preserves unfinished work. | Complete: attributed wrap/carry-forward and per-target bulk results |
| C3 | Action recovery and provider acceptance; C1/C2/T1 | Restart/retry never blindly repeats uncertain effects; bounded input, usage, cancellation and ledgers remain truthful; provider-backed local/remote scenarios establish actual execution separately from fake-adapter tests. | Complete: bounded action/usage/cancel/restart fixtures; broader provider endurance unverified |
| B1 | Serialized browser commands and cleanup; T3 | Per-agent commands are deterministic; separate agents remain independent; close waits for pending launch, popups/page loss are handled, profiles are retained explicitly, missing browser errors are actionable. | Complete: queue/page/close tests and browser integration |
| B2 | Existing browser/API boundary; B1/T2 | Profile and credential separation, control-port navigation/redirects, URL schemes and popups are tested; remote screenshot transfer is verified; documentation accurately describes OS/filesystem limits. | Complete: real profile, multi-hop redirect, popup, WebSocket and remote screenshot checks; OS sandbox excluded |
| U3 | Persistent recovery UI and large inventories; P2/D1/D2/UX3 | Initial failure, token rotation, missing tabs and partial sources recover without losing drafts/layout; failures remain visible near affected views; measured large fixtures guide bounded rendering. | Complete: fixture recovery/5,000-history checks and actual service restart |
| U2 | Notification outcomes and unavailable targets; D1/D2/P2 | Native test reports observed delivery/failure honestly; missing targets lead to useful saved output/activity; marker coalescing, mute/restart/outage semantics are tested; one watcher prevents duplicates. | Implemented: outcome/target/watcher tests; native banner/click unverified |
| U1 | Native workspace acceptance; UX1–UX3/P2/U3 | Native windows, menus, sizing, keyboard/clipboard, same-session attachments and quit/reopen are exercised with test-owned sessions. Unavailable automation is recorded without claiming a pass. | Native harness passed available checks; OS focus/minimize/fullscreen unavailable |
| Release | Final integrated review; all applicable rows | Relevant suites, build, desktop runtime, package/signature and install checks pass; installed files match and existing sessions survive; independent UX review has no unresolved required fixes. | Complete: 200 tests, build/runtime/native/SSH checks, signed package and verified 0.7.0 install; recorded acceptance limits retained |

## Review and implementation record

The user's reported problems were the starting acceptance cases. Three independent reviews covered output, navigation and scrolling; repeated source reviews and Chromium probes found and corrected these issues:

| Finding | Implemented remedy | Evidence |
| --- | --- | --- |
| Debug events bury answers; saved output loses Markdown | Shared safe formatter, one answer, collapsed Working details/Response data, copy controls, visible partial-failure summaries | Formatter and fixture UI checks; wide visual review |
| Follow state breaks on hidden panes, resizing and incoming output | Per-view follow state, persistent pin preference, unread/jump controls, anchored pagination, asynchronous xterm handling | Real Chromium and xterm checks; independent resize/hidden/disclosure probes |
| Disclosures skip their beginning; font changes lose the bottom | Explicit expansion pauses ordinary following; settings/font/layout changes restore the correct position | Independent Chromium review |
| Environment filter navigates; settings owner is unclear | Filtering preserves view/context; single initial chat; context and settings owner/model/reasoning/access visible | Fixture navigation checks and wide review |
| Drafts disappear on busy Enter/failure; saving discards newer settings | Retained composer draft, inline unconfirmed-message recovery, persistent draft on reload; mounted settings inputs and submitted-draft comparison | Delayed response/save fixtures |
| Provider rounds reuse item IDs; partial envelopes become prose | Round-scoped trace identity and nested response diagnostics | Formatter regression cases |
| Short reconstruction loses conversation continuity | Complete same-scope exchanges within the byte budget; marked newest-exchange excerpt when oversized | Bounded-context tests; existing project-boundary tests retained |
| Activity pagination reuses group IDs | Stable group membership with unique split keys; keyed team-message rows | Gap/prepend/selection regression cases |

All three reviewers reported no remaining required fixes in their reviewed UX scope after correction and repeat review. The native minimum-window check found hidden Send controls and a clipped final output line; bounded settings/composer height and final-message spacing corrected both. A delayed creation result could override a newer user selection; selection revisions now prevent that race. Native output, clipboard, live PTY, same-session windows, menu handlers, keyboard divider, pin/draft/layout restoration and quit survival passed. OS focus/minimize/fullscreen were unavailable to automation and remain separate.

## Implemented feature record

| Area | Change and source | Verification |
| --- | --- | --- |
| Installation/state | [Transactional installer](../scripts/desktop-install.mjs), [versioned nested state](../server/state-schema.mjs), flushed atomic writes and redacted diagnostics | Installer failure matrix, migrations/write failures, integration |
| Service/recovery | [Exact build identity](../shared/build-identity.cjs), [owned-service supervisor](../desktop/service-owner.cjs), authenticated renderer/watcher recovery | Actual isolated Electron utility-process kill/restart, token rotation and tmux preservation |
| Discovery/history | [Bounded reader](../server/bounded-reader.mjs), source health, wrapper descendants, stable process/server identity, [durable minimal remote index](../server/remote-index.mjs) | Stall/recovery, malformed/partial/offline fixtures, approved SSH checks |
| Launch/lifecycle | [Preflight](../server/launch-preflight.mjs), [shared provider arguments](../server/provider-commands.mjs), truthful launch states and shared owned-resource rollback | CLI help, local authenticated replies, lifecycle/team fixtures and remote shells |
| Communication | Explicit fetched/acknowledged states, attributable handoffs, per-agent helper ownership and [remote reconnect](../server/remote-reconnect.mjs) | Both approved servers: helper context, fetch/ack, screenshot transfer, transport loss, original-agent reconnect and cleanup |
| Chat work controls | [Clean owner intent](../server/owner-intent.mjs), [shared project edits](../server/project-records.mjs), next-scope selection guard, explicit bulk process control and attributed wrap evidence | Model-adapter/API/renderer fixtures; scope/isolation regressions retained |
| Action recovery | Started receipts before effects; unfinished receipts become uncertain on restart and block blind replay | Snapshot/restart fixture; cancellation/limits/usage tests |
| Browser | Per-agent command queues, pending-close/page/popup handling, retained profiles, HTTP(S)/control-port guards | Queue/page fixtures, real browser profile/redirect integration, actual remote PNG transfer |
| Notifications | [Observed delivery outcome](../desktop/notification-delivery.cjs), [target fallback](../src/notification-target.mjs), watcher reauthentication and explicit marker coalescing | Outcome/target/watcher fixtures; native banner/click remains unverified |

## Installed release

`0.7.0` is installed and reopened at the authoritative personal Applications path. All **200 tests** pass. Build, Electron runtime/crash recovery, native UI, approved SSH checks, strict deep signature, documentation links and whitespace checks pass within their recorded scopes. All **60** checked runtime/source/assets match the source build and exact runtime identity; health reports version `0.7.0`, protocol `2`. The state API responds with no source warnings and both approved remote sources healthy. All **four** pre-install tmux session/server identities survived. The generated app bundle was consumed and the previous app moved to Trash.

The implementation remains in the local working tree; this pass did not commit or push it. Native/remote acceptance details and exceptions follow. Engineering documentation updated after installation does not change the runtime build.

## Acceptance still needing an available environment

These are verification limits, not undisclosed missing implementations. They remain visible rather than being marked passed:

- Native OS focus, minimize and fullscreen were unavailable through the automation connection. Visible notification banners and clicks with open/closed windows remain unverified.
- Headless authenticated replies passed locally for Codex, Claude and Grok. The full interactive new/resume/slash-command/role-delivery matrix across remote owners has not been established. Both approved default SSH accounts have Codex; Claude and Grok were unavailable on their PATH. An isolated Claude config has no login; the local reply smoke used the existing native login with session persistence/tools disabled.
- Clean chat creation and scoped workflows pass deterministic adapter/integration tests. A broad paid-model end-to-end conversation and long-running provider behavior are not claimed by those tests.
- Native same-session windows preserve one tmux process. Their screen-size negotiation follows tmux; exhaustive remote multi-client resizing and physical OS shortcut dispatch remain unverified.

See [verification](verification.md) for exact test boundaries and release evidence. No private targets, credentials or personal transcripts are fixtures.

## Existing constraints and optional extensions

These are documented boundaries, not silently added feature commitments: adopting an arbitrary external terminal's live stdin/screen; reconstructing unlogged/private provider output; custom tmux-socket enumeration; drag-reordering tabs; restoring every extra window after quit; duplicate views in one window; public notarization/updater distribution; Linux/Windows acceptance; exact billing/token guarantees. They remain optional unless required to satisfy a concrete requested acceptance case.

## Supporting specifications

- [Discovery and history](plans/discovery-and-history.md): D1–D3.
- [Conductor and working sessions](plans/conductor-and-sessions.md): C1–C3.
- [Teams and agent lifecycle](plans/teams-and-agent-lifecycle.md): T1–T3.
- [Desktop and notifications](plans/desktop-and-notifications.md): U1–U3 and UX work.
- [Browsers and runtime isolation](plans/browsers-and-runtime.md): B1–B2.
- [Packaging and recovery](plans/packaging-and-recovery.md): P1–P3.
- [Current behavior](implementation-status.md) and [verification evidence](verification.md).

## Cleanup clarity and history follow-through (`0.7.1`)

Agents are grouped by project with open-goal counts; ordinary terminals and background services are collapsed. Meaningful task/history titles take precedence over process device names. Search and bounded saved-history rendering keep large inventories usable. A test teardown leak was fixed by cleaning its unique tmux server even when individual API deletion fails.

Conductor can retrieve old direct exchanges and saved project conversations without requiring live agents. Scoped provenance remains enforced and paging exposes more records without increasing the model input cap. Owner API path reconciliation preserves historical roots; explicit consolidation of empty duplicate project records preserves original IDs and files, while rejecting records with active assignments. See [verification](verification.md) and the updated subsystem plans for checked behavior and limits.
