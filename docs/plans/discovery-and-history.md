# Discovery and history

Status: D1/D2 implementation and regression checks complete; D3 adapters and isolated fixtures complete, with interactive provider/owner acceptance limits recorded in verification. Preserve the two approved SSH destinations and read-only provider history access. An inaccessible conversation must stay unknown rather than be invented or assigned to a convenient process.

Sources: [discovery](../../server/discovery.mjs), [remote reader](../../server/remote-reader.py), [history](../../server/history.mjs), [service](../../server/index.mjs), [activity](../../server/activity.mjs), [core tests](../../test/core.test.mjs), [matching tests](../../test/conductor.test.mjs).

## D1 — Healthy inventories and process identity

**Implemented.** Project classification uses verified Git roots, canonical paths and longest root containment within an exact environment. Explicit manual moves and Unassigned are preserved; enrolled project identity is pinned. External assignment identity includes exact local start identity or remote boot/start ticks; tmux identity includes the server incarnation. Stale assignments are ignored. Synthetic fixtures cover PID/server reuse, same-name roots, symlinks, worktrees, malformed Git markers and nonblocking reads.

**Implemented remedy.** Scans return source health and warnings. Partial scans preserve valid rows and mark retained evidence unknown; failed scans cannot emit false exits. A bounded child reader handles local filesystem discovery, history and classification. Wrapper shells are inspected for SSH/provider descendants; missing process evidence remains unknown. Remote lifecycle uses boot/start ticks and tmux server incarnation, rechecked before signaling.

An installed startup also stalled in a synchronous filesystem open, then recovered without a code change. Read-only Node/Electron probes did not reproduce the cause. The bounded reader now isolates filesystem discovery/history and a controlled stalled-reader fixture verifies timeout, parent responsiveness and fresh-reader recovery. The observed healthy response is recovery evidence, not a root-cause fix.

**Implementation contract.**

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

**Current gap.** Provider-internal or unlogged output cannot be reconstructed. Codex indexing caps unarchived threads; Claude subagent files and unsupported formats are not a complete agent inventory. A versioned minimal remote index now survives restart as stale metadata; full remote transcripts remain memory-only. Many live processes lack a deterministically matched transcript. Resume reconciles current matched live work and returns an attachable view or explains the external-process constraint.

**Implementation contract.**

- Expose coverage reasons to Conductor and the conversation view: unsupported source, inaccessible owner, absent transcript, bounded excerpt, ambiguity, or scan failure. Keep unreviewed work distinct from absent work.
- Add provider/owner fixtures for exact resume IDs, open files, start identity, shared runtimes, same-folder ambiguity, and changed/deleted logs. Keep uncertain candidates explicit.
- Before resuming, check current live evidence for the same conversation. Return the existing usable view or explain the external-process constraint; do not silently start duplicate work.
- Persist only the minimal remote index needed to retain an offline conversation list across service restarts. Version the cache, validate it on load, label it unavailable/stale, and never treat it as evidence of a live process. Do not persist full remote transcripts unless that storage behavior is deliberately chosen.
- Handle partial writes, missing files, schema changes, and inaccessible excerpts independently. Add targeted older-history lookup if necessary to answer a direct user query outside the default index cap; retain bounded reads.

**Dependencies.** D1 supplies trustworthy live identity and health. P3 supplies persisted cache validation. D3 provides supported format fixtures.

**Acceptance.** Two agents in the same folder are never assigned a conversation without matching evidence. A shared runtime can show multiple readable conversations without claiming a single active task. Offline/restarted services keep clearly labelled cached metadata, not false live rows. Resuming a matched live conversation does not duplicate its process. Conductor states coverage limits when a query cannot be answered from available history.

**Constraint.** A non-tmux external terminal's live screen and stdin cannot be safely adopted by reading its process or transcript. Unlogged/private messages cannot be reconstructed. Keep the original CLI available for the full supported conversation.

## Native Claude session identity

Local discovery classifies Claude daemon and background terminal-host processes as services. Explicit new session IDs take precedence over resumed originals when forking. Public native session records can link a live process only when PID, UTC process start, directory and provider identity all match; keys and messaging sockets are not read. This resolves saved names without guessing among same-folder conversations. [Provider-process tests](../../test/provider-process.test.mjs) cover PID reuse, mismatched directories and fork identity.

## Cleanup and historical project paths

Owner-directed location edits retain old root aliases, so moved folders remain associated with their saved histories. Consolidated empty tracking records point to one canonical project and cannot be automatically recreated from their retained roots. Processes keep their actual cwd. Integration teardown explicitly kills only its uniquely named test tmux server, including when API cleanup fails; production shutdown continues to preserve personal tmux sessions.

## D3 — Provider and SSH compatibility

**Implemented / acceptance limits.** Shared provider arguments serve local/remote new and resumed launches without permission overrides. Reader fixtures use isolated provider homes. Installed CLI help was checked; authenticated headless marker replies passed locally for Codex, Claude and Grok. Both approved remote default accounts have Codex; Claude/Grok were unavailable on their PATH. Actual remote shell, helper, screenshot and reconnect flows pass. Interactive slash commands, new/resume and prompt delivery across every provider/owner remain unverified. Local/remote parser parity fixtures pass; non-default remote home discovery remains a documented constraint.

**Implementation contract.**

- Extract small provider adapters only where needed to centralize launch/resume arguments, history metadata, and explicit completion markers. Preserve native CLI commands and approval behavior.
- Record supported CLI behavior from the installed tools and primary provider documentation when changing an adapter. Use sanitized fixtures, not personal transcripts.
- Point automated provider readers at fixture homes so checks do not depend on whichever personal histories happen to be installed. The existing integration/runtime checks isolate app data but can still read local provider histories.
- Exercise new and resumed Codex, Claude, and Grok sessions locally and through each approved environment/account where the provider is available. Check startup prompt delivery, original owner/cwd, mailbox access, and native slash commands.
- Report a missing CLI, unsupported resume flag, login requirement, or unreadable history accurately. Decide whether non-default remote provider home paths need discovery; do not assume local environment variables describe remote accounts.

**Dependencies.** T1 supplies launch readiness/failure reporting. D1/D2 consume adapter results.

**Acceptance.** Each supported provider/location has an explicit pass, failure, or unavailable entry in verification evidence. Unsupported combinations remain labelled, not counted as successful launches. Reader differences do not silently alter ownership, completion semantics, or matching.

## Recorded model identity

Codex indexes expose their model column when present, with compatibility for older schemas. Bounded provider output supplies Codex turn-context, Claude assistant and Grok model_id fallback identities. Local file metadata caches invalidate on inode/size/modification changes; missing files do not retain a fresh label. Minimal remote indexes preserve the identity and provenance as stale on restart. Labels distinguish provider-index metadata from last observed output and never infer a default model. Exact live-history matching precedes propagation to a session; empty identity fields cannot match each other. Local tmux panes retain matched process files/resume IDs without duplicating them as external rows. No inference/model call is used for discovery.

Untracked panes on the application tmux socket are also listed, with socket-qualified identities distinct from the default server. Attachment and lifecycle validation use that same socket; existing managed records are not duplicated. An isolated integration test types into such a recovered pane and verifies that detaching leaves it running.

## Canonical worktree grouping and observed activity

Local and remote readers inspect Git HEAD, commondir and objects metadata with bounded reads. The verified common directory identifies the main project even for outside worktrees; independent nested repositories remain distinct. Automatic classification uses the canonical repository root. Existing managed/manual task and authority records remain intact while `projectGroupId` supplies the overview. Remote pane rows use the inspected agent’s cwd and repository evidence together, including when the shell remained in a different directory. [Worktree fixtures](../../test/worktree-projects.test.mjs) exercise these boundaries and local/remote parity.

Provider output supplies bounded activity observations and native parent identity alongside model identity. Codex thread metadata and Claude’s parent/subagents layout provide exact relationships; Claude child records cannot be resumed as standalone sessions or matched as the parent process. The graph connects saved children only to known parent sessions in the same provider and environment. Source timestamps remain explicit; old work observations become unknown and old completed turns become idle. Minimal remote cache persistence keeps parent metadata but does not persist question text or activity snapshots. [Signal fixtures](../../test/session-signals.test.mjs) cover local/Python parity, unanswered requests, completion, stale evidence and hierarchy.
