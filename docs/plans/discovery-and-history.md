# Discovery and history

Status: partial implementation; D1–D3 remain open. Preserve the two approved SSH destinations and read-only provider history access. An inaccessible conversation must stay unknown rather than be invented or assigned to a convenient process.

Sources: [discovery](../../server/discovery.mjs), [remote reader](../../server/remote-reader.py), [history](../../server/history.mjs), [service](../../server/index.mjs), [activity](../../server/activity.mjs), [core tests](../../test/core.test.mjs), [matching tests](../../test/conductor.test.mjs).

## D1 — Healthy inventories and process identity

**Implemented.** Project classification uses verified Git roots, canonical paths and longest root containment within an exact environment. Explicit manual moves and Unassigned are preserved; enrolled project identity is pinned. External assignment identity includes exact local start identity or remote boot/start ticks; tmux identity includes the server incarnation. Stale assignments are ignored. Synthetic fixtures cover PID/server reuse, same-name roots, symlinks, worktrees, malformed Git markers and nonblocking reads.

**Current gap.** Local tmux/process errors are flattened into empty arrays. The local activity pass has no scan-health signal and can interpret an unavailable source as process exits. The remote reader catches some failures without describing which sources were incomplete. Lifecycle display and source-health acceptance remain broader than assignment identity tests.

An installed startup also stalled in a synchronous filesystem open, then recovered without a code change. Read-only Node/Electron probes did not reproduce the cause. Isolate filesystem discovery/history reads behind a bounded worker or process so an operating-system open delay cannot stall the service; verify with a controlled stalled-reader fixture. The observed healthy response is recovery evidence, not a root-cause fix.

**Implementation.**

- Give each scan a structured result containing rows, health, source, and readable diagnostics. Separate a successful empty scan from an unavailable or incomplete scan.
- Retain cached history independently from current process evidence. Do not count stale or unreachable processes as running, and do not emit exit events from failed scans.
- Contain a malformed row or inaccessible file to its own source. Preserve valid rows; surface a compact warning through the existing environment status and Conductor context.
- Track host, owner, PID, and process start identity where available. Bind assignments, lifecycle state, and exit detection to that identity. Revalidate identity immediately before signals.
- Test managed/default tmux reconciliation, remote owner distinctions, SSH transport loss, process disappearance during inspection, and shared provider runtimes. Distinguish an ordinary shell count from an agent count without adding a new screen.

**Dependencies.** No feature prerequisite. Identity changes must preserve existing managed IDs and migrate or invalidate stale external assignments deliberately.

**Acceptance.** Valid rows remain usable when another row/source fails. Failed scans produce no false completion/exit events. PID reuse cannot inherit an old tracking assignment or receive a stale signal. Healthy empty scans still remove departed processes. Shared runtimes remain protected from lifecycle actions. Test fixtures cover missing fields, non-string fields, diagnostic output, permissions, and process races.

**Constraint/decision.** Discovery currently covers the managed local socket, default tmux sockets, and visible provider processes; it is not an inventory of every custom socket, container, nested provider subagent, or inaccessible account. Add automatic custom-socket discovery only if needed; do not add SSH destinations or mandatory forms.

## D2 — History coverage, matching, and offline recovery

**Implemented.** Saved-output pages include messages, commentary, tool calls and results, with stable byte-offset event IDs, backward pagination and preserved recent output. Local/remote parsers have parity fixtures. Individual records over 8 MiB and missing logs are disclosed.

**Current gap.** Provider-internal or unlogged output cannot be reconstructed. Codex indexing caps unarchived threads; Claude subagent files and unsupported formats are not a complete agent inventory. A remote index survives a failed scan only in the running service's memory. Many live processes lack a deterministically matched transcript. The resume endpoint checks managed duplicates, but does not independently reconcile every possible external live match.

**Implementation.**

- Expose coverage reasons to Conductor and the conversation view: unsupported source, inaccessible owner, absent transcript, bounded excerpt, ambiguity, or scan failure. Keep unreviewed work distinct from absent work.
- Add provider/owner fixtures for exact resume IDs, open files, start identity, shared runtimes, same-folder ambiguity, and changed/deleted logs. Keep uncertain candidates explicit.
- Before resuming, check current live evidence for the same conversation. Return the existing usable view or explain the external-process constraint; do not silently start duplicate work.
- Persist only the minimal remote index needed to retain an offline conversation list across service restarts. Version the cache, validate it on load, label it unavailable/stale, and never treat it as evidence of a live process. Do not persist full remote transcripts unless that storage behavior is deliberately chosen.
- Handle partial writes, missing files, schema changes, and inaccessible excerpts independently. Add targeted older-history lookup if necessary to answer a direct user query outside the default index cap; retain bounded reads.

**Dependencies.** D1 supplies trustworthy live identity and health. P3 supplies persisted cache validation. D3 provides supported format fixtures.

**Acceptance.** Two agents in the same folder are never assigned a conversation without matching evidence. A shared runtime can show multiple readable conversations without claiming a single active task. Offline/restarted services keep clearly labelled cached metadata, not false live rows. Resuming a matched live conversation does not duplicate its process. Conductor states coverage limits when a query cannot be answered from available history.

**Constraint.** A non-tmux external terminal's live screen and stdin cannot be safely adopted by reading its process or transcript. Unlogged/private messages cannot be reconstructed. Keep the original CLI available for the full supported conversation.

## D3 — Provider and SSH compatibility

**Current gap.** Provider launch/resume flags and history schemas are encoded directly. Local and remote readers are separate implementations. Remote paths use account home conventions, while the local reader supports provider home environment overrides. Automated tests cover parser samples and shell launches rather than every real provider CLI/login/owner combination.

**Implementation.**

- Extract small provider adapters only where needed to centralize launch/resume arguments, history metadata, and explicit completion markers. Preserve native CLI commands and approval behavior.
- Record supported CLI behavior from the installed tools and primary provider documentation when changing an adapter. Use sanitized fixtures, not personal transcripts.
- Point automated provider readers at fixture homes so checks do not depend on whichever personal histories happen to be installed. The existing integration/runtime checks isolate app data but can still read local provider histories.
- Exercise new and resumed Codex, Claude, and Grok sessions locally and through each approved environment/account where the provider is available. Check startup prompt delivery, original owner/cwd, mailbox access, and native slash commands.
- Report a missing CLI, unsupported resume flag, login requirement, or unreadable history accurately. Decide whether non-default remote provider home paths need discovery; do not assume local environment variables describe remote accounts.

**Dependencies.** T1 supplies launch readiness/failure reporting. D1/D2 consume adapter results.

**Acceptance.** Each supported provider/location has an explicit pass, failure, or unavailable entry in verification evidence. Unsupported combinations remain labelled, not counted as successful launches. Reader differences do not silently alter ownership, completion semantics, or matching.
