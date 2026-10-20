# Architecture and behavior

This describes the code at `6726db5`, not the proposed implementation plans. See [status](implementation-status.md) for gaps and [operations](operations.md) for recovery.

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
            ├─ local process/history readers
            ├─ approved SSH read-only discovery/history readers
            ├─ Conductor → installed Codex CLI → model service
            ├─ scoped agent mailbox/context/progress API
            └─ per-managed-agent headless browser profiles
```

[main.cjs](../desktop/main.cjs) owns windows and starts or reuses a backend through [backend.cjs](../desktop/backend.cjs). [service.cjs](../desktop/service.cjs) imports the server inside Electron's utility process, giving it the bundled Node/native PTY runtime. The UI uses HTTP internally but is packaged as a desktop app; no public web service is required.

[preload.cjs](../desktop/preload.cjs) exposes only desktop window opening, notification testing, and menu actions. Renderers have context isolation, sandboxing, no Node integration, restricted navigation, blocked downloads, and a narrow clipboard permission. Local service logic lives in [index.mjs](../server/index.mjs).

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
| Scoped project/goal | Nested working-session records. Goals have todo/doing/done state and notes. These project IDs are currently distinct from top-level project IDs. |
| Scope | `{workSessionId, projectId, goalId}` selecting a session, a project within it, or a goal within that project. |
| Team/group | Team record has a name, mission, location, optional scope, and sometimes a project link. Managed membership and shared context currently use the group name. |
| Mailbox message | ID, sender, recipient, group, text, recorded timestamp, and read flag. Fetching the inbox marks messages read; it does not prove task acceptance. |
| Activity event | Successful response completion or observed process exit, with target, source identity, and deduplication key. It is not a goal-completion record. |

The separate project concepts, group-name identity, and PID identity are documented work in [C1](plans/conductor-and-sessions.md), [T2](plans/teams-and-agent-lifecycle.md), and [D1](plans/discovery-and-history.md).

## Discovery and history flow

1. Read managed and default local tmux panes, then visible local shell/provider processes. The external reader uses process metadata and open transcript files when accessible.
2. Scan only approved SSH hosts. The Python reader inspects Linux processes, available tmux servers, and provider histories. Existing passwordless sudo may extend read access to root, the SSH caller, and discovered process owners; the app does not grant new privileges.
3. Combine process rows with provider history metadata. Matching prefers a recorded history/resume ID or unique open transcript file; a unique provider/cwd/start match is a fallback. Ambiguity remains unlinked. A shared runtime can expose multiple linked files.
4. Publish current inventory plus coverage/errors. Failed SSH scans clear their live process rows and preserve in-memory history metadata. Local failures do not yet have equivalent structured health reporting.

[history.mjs](../server/history.mjs) reads local Codex SQLite/JSONL, Claude project JSONL, and Grok summary/chat JSONL. [remote-reader.py](../server/remote-reader.py) implements the remote variants. Source histories are never written by these readers. Reads are bounded, tolerate partial JSONL records, omit tool output, and return recent text. Codex's normal SQLite index includes up to 2,000 unarchived threads per account; fallback readers and other providers have different coverage. Reading a conversation is not a complete transcript export.

Local and remote indexes refresh independently with cached results; refreshes make no model calls. Remote indexes and transcripts are memory-only. History source locations, schema assumptions, owner permissions, and missing files can limit visibility. See [D1–D3](plans/discovery-and-history.md).

## Terminal launch, attachment, and tools

`createSession()` validates provider/location/scope, prepares a helper credential, builds the startup prompt, and creates a managed tmux session. Local agents run the installed provider executable. A remote managed session runs SSH inside local tmux and starts/attaches remote tmux when available. Resuming uses the original history environment and owner. If the CLI/SSH command ends, a local recovery shell remains.

The WebSocket route validates the desktop token and origin before starting a `node-pty` attachment. It supports managed local transport, discovered local default tmux, and discovered remote tmux. Input and resize messages have size/type limits. Ordinary external TTYs are not attached: their saved conversations are displayed read-only.

[agent-platform.mjs](../server/agent-platform.mjs) supplies the provider default prompt, task, team role/mission, scope, mailbox instructions, and browser helper commands. Managed agent credentials authorize only `/api/agent`. Same-group agents or agents sharing a human working session can communicate; external tracking assignments do not enroll a process.

Remote helpers use a loopback-only reverse SSH forward to the local service. [bridge.py](../server/bridge.py) uses Python's standard library and offers `peers`, `inbox`, `send`, `context`, `progress`, and `browser`. `context` reads the team's mission/scope and shared Markdown. Writing shared Markdown is available through the desktop API (and ordinary local filesystem access where permitted), not a dedicated helper write command. Progress is limited to the agent's scope and queues a note to Conductor.

The browser manager owns a persistent profile per managed ID, including for remote agents. Remote browser commands execute locally; screenshots are returned to and written on the helper's machine. See [B1–B2](plans/browsers-and-runtime.md) for lifecycle limits and the isolation boundary.

## Conductor flow

[coordinator.mjs](../server/coordinator.mjs) maintains one in-flight reply and persists conversation, memory, assessments, and action results. The first automatic briefing is enabled by default and starts only with empty Conductor history once environment scans have a result. Other model requests follow user prompts. Incoming agent messages are stored without automatically invoking the model.

The snapshot includes live terminals, small managed-pane excerpts, working sessions/projects/teams, recent mail, selected history evidence, and coverage counts. History review selects up to 18 pending records distributed across environments plus up to six relevant records, using small recent message excerpts. Assessments are accepted only for supplied evidence IDs and are versioned against history updates; unchanged assessments can be reused.

The installed Codex CLI invokes `gpt-6-luna` with low reasoning, structured output, a read-only sandbox, and shell/plugin/multi-agent/web capabilities disabled. It uses existing Codex login; bounded work context is sent through that account. Provider sign-in data is not copied into the repository.

The [schema](../server/conductor-schema.json) currently permits:

| Action family | Actions |
| --- | --- |
| Agents | `start_agent`, `resume_conversation`, `assign_agent`, `session_state`, `cleanup` |
| Teams/messages | `start_team`, `message_agent` |
| Persistent projects | `create_project`, `update_project` |
| Human sessions/goals | `start_work_session`, `work_session_state`, `goal_progress` |
| Evidence | `search_history`, `read_conversation` |

[performAction()](../server/conductor-actions.mjs) validates and executes actions; no arbitrary Conductor shell exists. A reply allows at most three model rounds, with at most two executed batches of four actions. Results return to the model for a final grounded answer. Automatic briefings may only search/read. The final round cannot execute more actions. Cancellation stops the model request and does not roll back actions. Usage currently records only the final round. Some control routes are not reachable through this action set; see [C1–C3](plans/conductor-and-sessions.md) and [T2](plans/teams-and-agent-lifecycle.md).

## Control surfaces and authentication

The service binds to `127.0.0.1`. It validates Host and supplied Origin, applies CSP, and places a random per-start desktop token in the bootstrap HTML. Desktop HTTP API calls use `X-Super-Terminal`; terminal WebSockets require that token and a valid Origin. `/desktop-health` identifies product/protocol/data directory without exposing the token. An agent token uses `X-Super-Terminal-Agent` and is accepted only for `POST /api/agent`.

| Surface | Capability |
| --- | --- |
| `/api/state`, `/api/history/:id`, `/api/activity` | Inventory, bounded saved text, activity |
| `/api/sessions`, `/api/sessions/:id` | Create/resume, patch metadata/scope, delete managed record/transport |
| `/api/hosts`, `/api/hosts/scan` | Select/scan an already-allowed host, never add an arbitrary target |
| `/api/work-sessions/...` | Human-session records, nested projects, goals |
| `/api/teams/...`, `/api/messages`, `/api/context` | Team records/launches/briefings, mailbox, shared text |
| `/api/prompts`, `/api/preferences` | Provider startup prompts and small preference set |
| `/api/coordinator`, `/api/coordinator/cancel` | Single Conductor request/cancellation |
| `/api/browser/:id` | Browser operations for a managed agent, desktop-authorized |
| `/api/agent` | Scoped helper operations only |
| `/terminal` | Authenticated PTY attachment, input, resize, and output |

These are internal local APIs, not a public multi-user service contract. Loopback restrictions and scoped helper tokens do not isolate mutually untrusted processes running as the same OS user. Agent CLIs keep their normal shell/filesystem permissions. Browser profile separation is not an OS sandbox.

## Workspace and activity

[workspace.mjs](../src/workspace.mjs) is a validated split tree with pane tabs, selected views, ratios, and an active pane. The renderer saves it in per-window localStorage. Main-window layout has a stable key; extra windows use generated keys. One global saved bounds file describes window geometry. Sidebar width/environment preferences also use localStorage. Tabs detach rather than terminate sessions.

[activity.mjs](../server/activity.mjs) reads explicit successful Codex, Claude, and Grok completion markers and compares healthy process inventories for exits. Startup and per-host baselines suppress old history; SSH failure does not imply exit. It retains 200 activity entries and deduplicates events. Providers without readable markers can supply only exit evidence. Multiple markers in one read currently collapse to the latest marker.

[notifications.cjs](../desktop/notifications.cjs) runs one watcher in the main process, including when all windows are closed. It deduplicates, honors the setting, and opens the event target when clicked. macOS controls whether banners/sound are shown. Native delivery acceptance is separate from parser/watcher tests.
