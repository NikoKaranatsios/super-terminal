# Architecture and behavior

This describes the `0.7.0` source build. See [status](implementation-status.md) for gaps and [operations](operations.md) for recovery.

## Process model

```text
Electron main process
  ├─ native menus, windows, notification watcher
  ├─ sandboxed renderer windows
  │    ├─ xterm panels ── authenticated WebSocket ─┐
  │    └─ lists/chat ──── authenticated HTTP ─────┤
  └─ owned utility process or reused service     │
       └─ loopback Express service ◀─────────────┘
            ├─ node-pty attachments → local tmux / SSH → remote tmux
            ├─ bounded child-process local process/history readers
            ├─ approved SSH read-only discovery/history readers
            ├─ Conductor → installed Codex CLI → model service
            ├─ scoped agent mailbox/context/progress API
            └─ per-managed-agent headless browser profiles
```

[main.cjs](../desktop/main.cjs) owns windows and starts or reuses a backend through [backend.cjs](../desktop/backend.cjs). [service.cjs](../desktop/service.cjs) imports the server inside Electron's utility process, giving it the bundled Node/native PTY runtime. The UI uses HTTP internally but is packaged as a desktop app; no public web service is required.

[preload.cjs](../desktop/preload.cjs) exposes desktop window opening, notification testing, validated web links, menu actions and a restricted runtime-patch save action. Patch export requires a trusted app frame and an explicit native destination choice. Renderers have context isolation, sandboxing, no Node integration, restricted navigation, blocked downloads, and a narrow clipboard permission. Local service logic lives in [index.mjs](../server/index.mjs).

Closing a view kills its PTY attachment, not tmux. Closing every window keeps the app running on macOS. Quitting stops the notification watcher and an owned backend; a reused backend is left running. Backend shutdown detaches PTYs, closes browsers, and cancels Conductor. tmux sessions survive service exit. A machine reboot does not preserve their processes.

## Domain vocabulary

| Object | Meaning and identity |
| --- | --- |
| Environment | `local` or a target from the private SSH allowlist; labels are separate from targets. |
| Managed terminal session | App-created record with UUID, tmux name, provider, host, cwd, group, role, optional scope/history link, and private agent token. A terminal can remain as a recovery shell after its provider exits. |
| Discovered session/process | Imported default tmux pane, remote tmux pane, or external PID. It may be read-only, attachable, controllable, or unavailable depending on kind/permissions. |
| Provider runtime | A shared/background process that may host several conversations. It is not automatically an individual active task. |
| Saved conversation | Provider-owned history, identified by provider/session ID and environment. The platform displays bounded text and source metadata. |
| Persistent project | Top-level `state.projects` metadata for an existing host/folder; active or archived. |
| Human working session | `state.workSessions` entry with active/paused/wrapped state, notes, summary, nested projects, and goals. This is separate from a terminal session. |
| Scoped project/goal | Nested working-session records. Goals mirror canonical task state and notes; nested projects link to persistent projects through `canonicalProjectId`. |
| Task | Canonical ID, project, optional session scope/parent, title, todo/doing/blocked/done/stopped state, notes, assigned agent, revision, attributed evidence and bounded activity. |
| Scope | `{workSessionId, projectId, goalId}` selecting a session, a project within it, or a goal within that project. |
| Team/group | Team record has a name, mission, location, optional scope, and sometimes a project link. Only explicit stable team membership permits sharing. Shared Markdown uses project/team/agent identity, not names or folders. |
| Mailbox message | ID, sender, recipient, group, text, recorded timestamp, fetched/read state and explicit acknowledgment. Acknowledgment requires a fetched, currently visible recipient message and does not prove work completed. |
| Activity event | Response completion, observed process exit, or a Conductor-selected notification, with target and deduplication key. Only explicit Conductor notification choices reach native banners. |

Stable scope/identity rules and acceptance limits are documented in [C1](plans/conductor-and-sessions.md), [T2](plans/teams-and-agent-lifecycle.md), and [D1](plans/discovery-and-history.md).

## Discovery and history flow

1. Read managed and default local tmux panes, then visible local shell/provider processes. The external reader uses process metadata and open transcript files when accessible.
2. Scan only approved SSH hosts. The Python reader inspects Linux processes, available tmux servers, and provider histories. Existing passwordless sudo may extend read access to root, the SSH caller, and discovered process owners; the app does not grant new privileges.
3. Combine process rows with provider history metadata. Matching prefers a recorded history/resume ID or unique open transcript file; a unique provider/cwd/start match is a fallback. Ambiguity remains unlinked. A shared runtime can expose multiple linked files.
4. Publish current inventory plus coverage/errors. Failed scans expose source health and retain usable evidence as unknown/stale without generating false exits. Local filesystem operations run in a deadline-bounded child process.

[history.mjs](../server/history.mjs) reads local Codex SQLite/JSONL, Claude project JSONL, and Grok summary/chat JSONL. [remote-reader.py](../server/remote-reader.py) implements the remote variants. Source histories are never written by these readers. Saved-output pages include messages, commentary, tool calls and results, using backward byte cursors and stable event IDs. Compact messages are a separate projection for model input. Reads tolerate partial JSONL records and disclose unavailable or oversized content. Codex's normal SQLite index includes up to 2,000 unarchived threads per account; fallback readers and other providers have different coverage. Reading a conversation is not a complete transcript export.

Local and remote indexes refresh independently with cached results; refreshes make no model calls. Minimal remote indexes are versioned and persisted; restored entries are stale, not live evidence. Full remote transcripts remain memory-only. History source locations, schema assumptions, owner permissions, and missing files can limit visibility. See [D1–D3](plans/discovery-and-history.md).

## Terminal launch, attachment, and tools

`createSession()` validates provider/location/scope and prerequisites, then prepares a helper credential, builds the startup prompt, and creates a managed tmux session. Local agents run the installed provider executable. A remote managed session runs SSH inside local tmux and starts/attaches required remote tmux. Resuming uses the original history environment and owner. If the CLI/SSH command ends, a local recovery shell remains.

The WebSocket route validates the desktop token and origin before starting a `node-pty` attachment. It supports managed local transport, discovered local default tmux, and discovered remote tmux. Input and resize messages have size/type limits. Ordinary external TTYs are not attached: their saved conversations are displayed read-only.

[agent-platform.mjs](../server/agent-platform.mjs) supplies the provider default prompt, task, team role/mission, scope, mailbox instructions, and browser helper commands. Managed agent credentials authorize only `/api/agent`. Only explicit team membership grants peer sharing; external tracking assignments do not enroll a process.

Remote helpers use a loopback-only reverse SSH forward to the local service. [bridge.py](../server/bridge.py) uses Python's standard library and offers mailbox/context/acknowledgment, legacy progress, `task create/report/list/flush/pending/discard`, and browser commands. Task events enter a private durable outbox before submission, carry enrollment/assignment identity and a monotonic sequence, and retry idempotently. `context` reads the team's mission/scope and shared Markdown. Writing shared Markdown is available through the desktop API (and ordinary local filesystem access where permitted), not a dedicated helper write command. Task creation/progress is limited to enrollment scope and updates canonical state without model calls. It does not grant new execution authority.

In host mode, the browser manager owns a persistent profile per managed ID, including remote agents; those remote browser commands execute locally and screenshot bytes return through the bridge. In isolated teams, each browser runs inside its agent container. See [B1–B2](plans/browsers-and-runtime.md) for lifecycle limits and the isolation boundary.

## Conductor flow

[coordinator.mjs](../server/coordinator.mjs) maintains one in-flight reply and persists conversation, memory, assessments, action results, aggregate usage and provider-visible trace events. The optional first briefing remains read-only. [conductor-loop.mjs](../server/conductor-loop.mjs) continuously collects structured work every five seconds. Eligible changes can trigger decisions no more often than every 30 seconds; unchanged active work uses a two-minute pulse and other unfinished work a ten-minute pulse. Empty or unchanged completed scopes make no model calls. Errors back off to a maximum 15 minutes. These are runtime cadence controls, not delivery promises. Run/pause/stop intent survives restarts; the loop runs only while the backend runs.

Snapshots include bounded tasks, assigned agents, relevant project/session/team metadata, attributed mail and omission counts. Continuous rounds use structured reports, not repeated transcript reads. Manual reviews read up to four pending and two relevant history excerpts. Serialized model input is capped at 24,000 bytes, not an exact token amount. Fresh active-scope checks in [conductor-policy.mjs](../server/conductor-policy.mjs) run before each autonomous action; archived projects, paused/wrapped sessions, stopped work and unrelated external processes cannot acquire authority from agent messages.

Manual chat invokes the installed Codex CLI with native config/instructions/skills and per-working-session model, reasoning, access and skill preference. No-session defaults work immediately; full file access is the default. Effective runtime is frozen per turn. Background/briefing/owner-intent invocations retain disabled direct tools and skills. It uses existing Codex login; bounded work context is sent through that account. Provider sign-in data is not copied into the repository.

The [schema](../server/conductor-schema.json) currently permits:

| Action family | Actions |
| --- | --- |
| Agents | `start_agent`, `resume_conversation`, `assign_agent`, `rename_agent`, `session_state`, `bulk_session_state`, `cleanup` |
| Teams/messages | `create_team`, `configure_team_runtime`, `start_team`, `update_team`, `brief_team`, `add_team_members`, `message_agent`, `prompt_agent` |
| Persistent projects | `create_project`, `update_project` |
| Human sessions/goals | `start_work_session`, `add_work_project`, `work_session_state`, `create_goal`, `update_goal`, `create_task`, `update_task`, `goal_progress` |
| Evidence / attention | `search_history`, `read_conversation`, `notify` |

[performAction()](../server/conductor-actions.mjs) validates and executes platform actions; manual chat separately has native shell/file tools under its selected access. A reply allows at most three normal model rounds plus one clean owner-intent creation invocation, with at most two executed batches of four actions. Results return to the model for a final grounded answer. Automatic briefings may only search/read. The final round cannot execute more actions. Cancellation stops the model request and does not roll back actions. Usage accumulates across every round with available telemetry. Started mutation receipts persist before effects; unresolved receipts become uncertain on restart and prevent blind replay. Continuous launch/message/notification receipts prevent exact repeated actions, and team retries reuse existing roles. Failed or partial effects remain visible. See [C1–C3](plans/conductor-and-sessions.md) and [T2](plans/teams-and-agent-lifecycle.md).

## Control surfaces and authentication

The service binds to `127.0.0.1`. It validates Host and supplied Origin, applies CSP, and places a random per-start desktop token in the bootstrap HTML. Desktop HTTP API calls use `X-Super-Terminal`; terminal WebSockets require that token and a valid Origin. `/desktop-health` identifies product/protocol/data directory/exact build without exposing the token. An agent token uses `X-Super-Terminal-Agent` and is accepted only for `POST /api/agent`.

| Surface | Capability |
| --- | --- |
| `/api/state`, `/api/history/:id`, `/api/activity` | Inventory, paginated saved output, activity |
| `/api/sessions`, `/api/sessions/:id` | Create/resume, patch metadata/scope, delete managed record/transport |
| `/api/sessions/:id/control`, `/api/sessions/:id/prompt`, `/api/sessions/:id/reconnect` | Shared process lifecycle, cooperative prompt queue and original-remote-agent bridge recovery |
| `/api/tasks` | Canonical task listing and validated create/update |
| `/api/hosts`, `/api/hosts/scan` | Select/scan an already-allowed host, never add an arbitrary target |
| `/api/work-sessions/...` | Human-session records, nested projects, goals |
| `/api/teams/...`, `/api/messages`, `/api/context` | Team records/launches/briefings, mailbox, shared text |
| `/api/prompts`, `/api/preferences` | Provider startup prompts and small preference set |
| `/api/coordinator`, `/api/coordinator/cancel`, `/api/coordinator/control` | Single request/cancellation and persistent loop controls |
| `/api/coordinator/settings`, `/api/coordinator/catalog` | Per-working-session runtime settings and native model/skill discovery |
| `/api/diagnostics` | Redacted version/schema, counts and source health |
| `/api/browser/:id` | Browser operations for a managed agent, desktop-authorized |
| `/api/agent` | Scoped helper operations, managed delegation and per-agent browser commands |
| `/api/runtime/capability`, `/api/runtime/prepare` | Approved-environment Docker/image readiness and bounded image preparation |
| `/api/teams/:id/runtime`, `/api/teams/:id/runtime/control` | Owner-only runtime grants and team lifecycle |
| `/api/sessions/:id/changes` | Retained-work binary patch export without modifying the original checkout |
| `/terminal` | Authenticated PTY attachment, input, resize, and output |

These are internal local APIs, not a public multi-user service contract. Loopback restrictions and scoped helper tokens do not isolate mutually untrusted processes running as the same OS user. Host-mode agent CLIs keep their normal shell/filesystem permissions. Browser profile separation is not an OS sandbox. Explicit isolated teams add the [documented container boundary](plans/isolated-teams.md), private volumes and a host-controlled stdio bridge; no host owner credential is mounted. Native provider approvals remain unchanged.

## Workspace and activity

[workspace.mjs](../src/workspace.mjs) is a validated split tree with pane tabs, selected views, ratios, and an active pane. The renderer saves it in per-window localStorage. Main-window layout has a stable key; extra windows use generated keys. One global saved bounds file describes window geometry. Sidebar width/environment preferences also use localStorage. Tabs detach rather than terminate sessions.

[activity.mjs](../server/activity.mjs) reads explicit successful Codex, Claude, and Grok completion markers and compares healthy process inventories for exits. Startup and per-host baselines suppress old history; SSH failure does not imply exit. It retains 200 activity entries and deduplicates events. Providers without readable markers can supply only exit evidence. Multiple markers in one bounded read deliberately coalesce to the latest successful marker, covered by fixtures.

[notifications.cjs](../desktop/notifications.cjs) runs one watcher in the main process, including when all windows are closed. It deduplicates, honors the setting, and opens the event target when clicked. macOS controls whether banners/sound are shown. Native delivery acceptance is separate from parser/watcher tests.

The renderer starts with one Conductor pane. Keyed message reconciliation preserves selection/disclosures, Markdown replies share one safe formatter, and tool/response details stay collapsed. Each output view follows by default, pauses for reading, and offers a persistent bottom pin. Drafts, settings edits and context selection survive delayed responses and backend/token recovery. Notification delivery records show/failure/unavailable/unconfirmed outcomes and resolves missing targets to saved output or Activity.
