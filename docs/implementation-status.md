# Implementation status

Feature baseline: `f4252a8`; current work adds continuous coordination and task navigation. See [verification](verification.md) for the distinction between source audit, automated checks, and native desktop evidence.

## Requirements coverage

| Requirement | Current behavior and limits | Status / remaining plan |
| --- | --- | --- |
| Local desktop terminal collection | Electron starts its own loopback service; provider CLIs run in tmux through xterm. A browser entry point exists for development. | Implemented; [P1–P3](plans/packaging-and-recovery.md) cover runtime and recovery gaps. |
| Compact terminal and task views | Dark monospace UI; Conductor shares the terminal palette with distinct event colors, bright/dim text, ANSI styling and prose/code emphasis; clear working-session controls and task/role agent titles; project-grouped task squares, project tables, and task details; readable teams and chat-based creation. | Implemented with fixture renderer checks; native acceptance remains in [U1](plans/desktop-and-notifications.md). |
| Only Local, 157, Romagnolo 91 | Private `connections.json` controls the SSH allowlist. Repository examples contain placeholders. | Implemented for the personal installation; preserve in all plans. |
| Pick up agents started outside the app | Scans local processes/default tmux and approved SSH processes/tmux; reads supported provider history. Shared runtimes have a separate label. | Partial: discovery is best effort, not universal enumeration. [D1–D3](plans/discovery-and-history.md). |
| Click an agent to see its conversation | Managed and discovered tmux can attach live; ordinary external agents show matched saved text or possible matches. | Implemented with constraints: no safe adoption of arbitrary TTY input; missing/unlogged history is unavailable. [D2](plans/discovery-and-history.md). |
| Keep native Codex, Claude, Grok commands | PTYs run the installed CLI, keeping its commands, rendering, and existing sign-in. Provider launch/resume flags are hardcoded. | Partial verification across providers and remote owners. [D3](plans/discovery-and-history.md), [T1](plans/teams-and-agent-lifecycle.md). |
| Conductor reads old work and identifies what remains | Bounded history excerpts, cached classifications, persistent chat/memory, explicit unreviewed coverage, and follow-up questions. | Implemented within index/excerpt limits. Classification is an assessment, not verified project completion. [C3](plans/conductor-and-sessions.md). |
| Continuous Conductor with bounded consumption | Model-free collection, paced decision rounds for active authorized work, no empty idle calls, error backoff, visible pause/stop, scoped actions, 24,000-byte input cap, aggregate round usage and action receipts. | Implemented with fake model checks. Byte cap is not an exact token budget. Provider acceptance remains in [C3](plans/conductor-and-sessions.md). |
| Manage work through one chat | Start/resume/name/pause/stop/prompt agents, create/update tasks and goals, start/edit/brief teams, add members, manage projects and sessions. Process actions share lifecycle handling and return partial results. | Implemented; prompt delivery remains cooperative and queued, not an arbitrary CLI keystroke injection. [T1–T3](plans/teams-and-agent-lifecycle.md). |
| Sessions, projects and canonical tasks | Legacy goals migrate into canonical tasks without dropping IDs/notes; nested projects link to persistent project IDs. Scoped launch location is resolved before launch. Carry-forward retains source links. | Implemented; broader persisted-state validation remains in [P3](plans/packaging-and-recovery.md). |
| Automatic task collection and session overview | Scoped helper events create tasks and report progress with deduplication, revisions and attributed completion evidence. Three views share the canonical records. Human-session pause/wrap is explicitly separate from process control. | Implemented; evidence is actor-reported, not independent test verification. [C2](plans/conductor-and-sessions.md). |
| Teams and default prompts | New managed agents receive provider prompt, task/role/scope, mailbox instructions, and isolated browser helper. Teams can launch mixed providers. | Implemented for managed launches; provider and remote launch acceptance remains. [T1](plans/teams-and-agent-lifecycle.md). |
| Agents communicate; user can read it | Scoped mailbox, peer/context/progress commands, and Team messages view with sender, recipient, group, and read flag. | Partial: inbox polling is cooperative; no reliable acknowledgment of work acceptance. Reassignment and tunnel recovery need consolidation. [T2](plans/teams-and-agent-lifecycle.md). |
| Include external agents in teams | Tracking assignment is supported. | Constraint: assignment does not inject prompts, helper credentials, or a mailbox into a running external process. Optional enrollment decision in [T2](plans/teams-and-agent-lifecycle.md). |
| Browsers separate from personal tabs | Headless persistent browser profile per managed session, controlled by helper. Remote helpers also use browsers on the local service machine. | Implemented profile isolation; not an OS/filesystem sandbox. [B1–B2](plans/browsers-and-runtime.md). |
| Multiple views and adjustable panels | Up to six panels per window; mouse/keyboard resizing, sidebar resizing, main layout persistence, separate native windows. | Implemented, native acceptance incomplete. Extra windows are not recreated as a set; no tab drag/reordering. [U1](plans/desktop-and-notifications.md). |
| Conductor-selected notifications | Raw completion/exit events remain Activity data. Only validated, deduplicated Conductor notification choices reach the native watcher, subject to user preference. | Automated watcher/decision tests pass; native banners depend on OS permission and require separate acceptance. [U2](plans/desktop-and-notifications.md). |
| Sensible settings | Text size, Conductor notifications/test button, automatic first briefing, provider startup prompts. Loop controls are directly visible; goals and teams use chat. | Implemented without setup forms. |
| One installed version, no backup app clutter | Successful installer replaces the authoritative app, moves the old app to Trash, and consumes the generated build copy. | Implemented success path; failure/rollback paths need fixture tests. Trash is not permanently erased. [P1](plans/packaging-and-recovery.md). |
| Code in the supplied GitHub repository | Source baseline is committed and pushed to the requested repository. Private runtime data and generated app bundles are excluded. | Implemented. Distribution beyond personal macOS use is not a requirement. |
| Document remaining work without time horizons | This documentation set and repository instructions record gaps, dependencies, and completion criteria. | Implemented by this documentation change. |

## Concrete audit findings

These are source findings, not newly reproduced production incidents. Each has a specific implementation item rather than an implicit promise of a fix.

| Finding | Evidence | Plan |
| --- | --- | --- |
| Local scanner failures can become an empty live inventory, while activity treats the local scan as healthy. Remote reader failures also lack detailed per-source coverage. | `tmuxSessions()` and `externalTerminals()` catch to `[]`; activity calls `processes('local', sessions)` without health information. | [D1](plans/discovery-and-history.md) |
| Remote indexes/transcripts are memory caches; offline history retention does not survive service restart. | `remoteCache` and `EnvironmentHistory.transcripts` are Maps. | [D2](plans/discovery-and-history.md) |
| Some launch readiness and remote bridge recovery remain unverified across provider/SSH combinations. | Local shell integration and mocked remote partial failures pass; live provider credentials are not used by automated checks. | [T1–T3](plans/teams-and-agent-lifecycle.md), [D3](plans/discovery-and-history.md) |
| PID-based tracking assignments can survive process replacement, although signal execution now rechecks executable/start identity. | External IDs remain PID-based; the shared lifecycle module rejects missing/mismatched identity. | [D1](plans/discovery-and-history.md) |
| Team context files still use a name-derived path, even though membership now uses team IDs. Automatic recovery of a lost reverse tunnel is not implemented. | `ensureContext()` and managed SSH transport. | [T2](plans/teams-and-agent-lifecycle.md) |
| Backend reuse checks protocol/data directory but not source build identity. Unexpected owned backend exit requires app restart. | `probeBackend()` and `main.cjs` restart dialog. | [P2](plans/packaging-and-recovery.md) |
| Store validation checks only the top-level sessions/hosts arrays; other nested shapes and state migrations have no common validator. | `createStore()` and startup `||=` defaults. | [P3](plans/packaging-and-recovery.md) |

## Resolved discovery error

The reported `Cannot read properties of undefined (reading 'replace')` coincided with `/api/state` returning an error. The fix at `6726db5` validates tmux rows and normalizes optional TTY values before string operations. The renderer also tolerates a missing managed title and restores the workspace after a successful retry of initial state loading.

The original malformed input row was not captured. The regression test reproduces the unsafe missing-TTY condition; it does not establish which external row first triggered the incident. After installation, the state endpoint and both approved SSH scans succeeded. [Core tests](../test/core.test.mjs) cover malformed/diagnostic tmux lines and missing TTYs. [D1](plans/discovery-and-history.md) tracks broader failure isolation; it is not a reopening of the same fixed exception.

## Output and task protocol

[transcript.mjs](../server/transcript.mjs) and the remote reader expose saved messages, commentary and tool traffic with byte-offset cursors and stable event IDs. The compact message projection remains separate for Conductor context. Reads tolerate partial JSONL writes and disclose oversized records; provider-internal reasoning and unlogged output are unavailable. [Transcript tests](../test/transcript.test.mjs) cover boundary paging and local/remote parity.

[tasks.mjs](../server/tasks.mjs) stores runtime task records privately. Agent-created tasks stay in the enrollment scope; events do not authorize launches or change CLI permissions. [conductor-policy.mjs](../server/conductor-policy.mjs) validates continuous actions against fresh active scope. Human-session controls, task state, provider response completion and process state remain distinct.
