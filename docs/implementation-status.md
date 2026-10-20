# Implementation status

Baseline: `6726db5`, package `0.4.1`. See [verification](verification.md) for the distinction between source audit, automated checks, and native desktop evidence.

## Requirements coverage

| Requirement | Current behavior and limits | Status / remaining plan |
| --- | --- | --- |
| Local desktop terminal collection | Electron starts its own loopback service; provider CLIs run in tmux through xterm. A browser entry point exists for development. | Implemented; [P1–P3](plans/packaging-and-recovery.md) cover runtime and recovery gaps. |
| Minimal terminal design, no board | Dark monospace UI, flat tabs, environment sidebar, Conductor, team messages, Activity, and Settings. No task board. | Implemented; [U1](plans/desktop-and-notifications.md) verifies desktop behavior. |
| Only Local, 157, Romagnolo 91 | Private `connections.json` controls the SSH allowlist. Repository examples contain placeholders. | Implemented for the personal installation; preserve in all plans. |
| Pick up agents started outside the app | Scans local processes/default tmux and approved SSH processes/tmux; reads supported provider history. Shared runtimes have a separate label. | Partial: discovery is best effort, not universal enumeration. [D1–D3](plans/discovery-and-history.md). |
| Click an agent to see its conversation | Managed and discovered tmux can attach live; ordinary external agents show matched saved text or possible matches. | Implemented with constraints: no safe adoption of arbitrary TTY input; missing/unlogged history is unavailable. [D2](plans/discovery-and-history.md). |
| Keep native Codex, Claude, Grok commands | PTYs run the installed CLI, keeping its commands, rendering, and existing sign-in. Provider launch/resume flags are hardcoded. | Partial verification across providers and remote owners. [D3](plans/discovery-and-history.md), [T1](plans/teams-and-agent-lifecycle.md). |
| Conductor reads old work and identifies what remains | Bounded history excerpts, cached classifications, persistent chat/memory, explicit unreviewed coverage, and follow-up questions. | Implemented within index/excerpt limits. Classification is an assessment, not verified project completion. [C3](plans/conductor-and-sessions.md). |
| Minimal Conductor consumption | No model polling for discovery. Automatic initial briefing is optional; other requests are user-triggered. Model rounds, actions, and review excerpts have caps. | Partial: the full snapshot is not globally bounded and recorded usage covers only the final model round. [C3](plans/conductor-and-sessions.md). |
| Manage everything through one chat | Start/resume agents, start teams, queue messages, manage project records/assignments, lifecycle controls, working sessions, goals, and cleanup. | Partial: several existing API controls have no Conductor action; lifecycle behavior varies by path. [C1–C2](plans/conductor-and-sessions.md), [T2–T3](plans/teams-and-agent-lifecycle.md). |
| Sessions → Projects → Goals/Tasks | Human sessions contain projects and goals; agents can carry scope at each layer. Topic parsing, progress, wrap-up summary, and unfinished-goal carry-forward exist. | Partial: global project records and nested session projects are separate, and scoped launches do not inherit nested project location. [C1](plans/conductor-and-sessions.md). |
| Briefing, progress, wrap-up, session overview | Available through Conductor and structured state; wrap-up uses recorded goal statuses and notes. | Partial: no dedicated session overview response contract; no automatic reconciliation of conflicting evidence. Human-session pause/wrap does not pause/stop agents. [C2](plans/conductor-and-sessions.md). |
| Teams and default prompts | New managed agents receive provider prompt, task/role/scope, mailbox instructions, and isolated browser helper. Teams can launch mixed providers. | Implemented for managed launches; provider and remote launch acceptance remains. [T1](plans/teams-and-agent-lifecycle.md). |
| Agents communicate; user can read it | Scoped mailbox, peer/context/progress commands, and Team messages view with sender, recipient, group, and read flag. | Partial: inbox polling is cooperative; no reliable acknowledgment of work acceptance. Reassignment and tunnel recovery need consolidation. [T2](plans/teams-and-agent-lifecycle.md). |
| Include external agents in teams | Tracking assignment is supported. | Constraint: assignment does not inject prompts, helper credentials, or a mailbox into a running external process. Optional enrollment decision in [T2](plans/teams-and-agent-lifecycle.md). |
| Browsers separate from personal tabs | Headless persistent browser profile per managed session, controlled by helper. Remote helpers also use browsers on the local service machine. | Implemented profile isolation; not an OS/filesystem sandbox. [B1–B2](plans/browsers-and-runtime.md). |
| Multiple views and adjustable panels | Up to six panels per window; mouse/keyboard resizing, sidebar resizing, main layout persistence, separate native windows. | Implemented, native acceptance incomplete. Extra windows are not recreated as a set; no tab drag/reordering. [U1](plans/desktop-and-notifications.md). |
| Agent completion notifications | Explicit successful provider turn records and distinct process-exit events; Activity history; native watcher shared by all windows. | Implemented, native banner/click acceptance incomplete. Latest-marker sampling and unavailable targets have limits. [U2](plans/desktop-and-notifications.md). |
| Sensible settings | Text size, finish notifications/test button, automatic first briefing, provider startup prompts. | Implemented. Avoid adding configuration forms to solve internal lifecycle problems. |
| One installed version, no backup app clutter | Successful installer replaces the authoritative app, moves the old app to Trash, and consumes the generated build copy. | Implemented success path; failure/rollback paths need fixture tests. Trash is not permanently erased. [P1](plans/packaging-and-recovery.md). |
| Code in the supplied GitHub repository | Source baseline is committed and pushed to the requested repository. Private runtime data and generated app bundles are excluded. | Implemented. Distribution beyond personal macOS use is not a requirement. |
| Document remaining work without time horizons | This documentation set and repository instructions record gaps, dependencies, and completion criteria. | Implemented by this documentation change. |

## Concrete audit findings

These are source findings, not newly reproduced production incidents. Each has a specific implementation item rather than an implicit promise of a fix.

| Finding | Evidence | Plan |
| --- | --- | --- |
| Local scanner failures can become an empty live inventory, while activity treats the local scan as healthy. Remote reader failures also lack detailed per-source coverage. | `tmuxSessions()` and `externalTerminals()` catch to `[]`; activity calls `processes('local', sessions)` without health information. | [D1](plans/discovery-and-history.md) |
| Remote indexes/transcripts are memory caches; offline history retention does not survive service restart. | `remoteCache` and `EnvironmentHistory.transcripts` are Maps. | [D2](plans/discovery-and-history.md) |
| A working-session project ID is resolved as scope but not as the launch host/cwd source. Topic parsing always creates `host: 'local'`, even if a matched history folder is remote. | `performAction()` consults global projects before scope; `parseTopics()` sets local host. | [C1](plans/conductor-and-sessions.md) |
| Conductor cannot append/edit nested projects/goals or edit/rebrief an existing team through its action schema. | HTTP routes exist in `index.mjs`; corresponding action types are absent from `conductor-schema.json`. | [C1](plans/conductor-and-sessions.md), [T2](plans/teams-and-agent-lifecycle.md) |
| Goal completion evidence is required through Conductor/helper but not through the direct goal PATCH route. | Separate validators in `conductor-actions.mjs` and `index.mjs`. | [C2](plans/conductor-and-sessions.md) |
| Conductor assignment changes metadata without the briefing message sent by the session PATCH route. Group names are also mailbox/context identity. | `assign_agent`, session PATCH, `canCommunicate()`, `contextPath()`. | [T2](plans/teams-and-agent-lifecycle.md) |
| Stop, DELETE, and cleanup handle remote tmux, browser instances, and bridge artifacts differently. Stopped records still authenticate helper tokens until removal. | Lifecycle action, `/api/sessions/:id` DELETE, `prepareBridge()`, `/api/agent` auth. | [T3](plans/teams-and-agent-lifecycle.md) |
| Stale PID-based tracking assignments can survive process replacement; signal identity checks do not compare process start identity. | External IDs use PID, assignments/lifecycle persist by ID; external control checks executable basename. | [D1](plans/discovery-and-history.md), [T3](plans/teams-and-agent-lifecycle.md) |
| Conductor snapshot size grows with terminal/project/team state, and usage from preceding model rounds is discarded. | `Coordinator.snapshot()` and final `entry.usage = result.usage`. | [C3](plans/conductor-and-sessions.md) |
| Backend reuse checks protocol/data directory but not source build identity. Unexpected owned backend exit requires app restart. | `probeBackend()` and `main.cjs` restart dialog. | [P2](plans/packaging-and-recovery.md) |
| Store validation checks only the top-level sessions/hosts arrays; other nested shapes and state migrations have no common validator. | `createStore()` and startup `||=` defaults. | [P3](plans/packaging-and-recovery.md) |

## Resolved discovery error

The reported `Cannot read properties of undefined (reading 'replace')` coincided with `/api/state` returning an error. The fix at `6726db5` validates tmux rows and normalizes optional TTY values before string operations. The renderer also tolerates a missing managed title and restores the workspace after a successful retry of initial state loading.

The original malformed input row was not captured. The regression test reproduces the unsafe missing-TTY condition; it does not establish which external row first triggered the incident. After installation, the state endpoint and both approved SSH scans succeeded. [Core tests](../test/core.test.mjs) cover malformed/diagnostic tmux lines and missing TTYs. [D1](plans/discovery-and-history.md) tracks broader failure isolation; it is not a reopening of the same fixed exception.
