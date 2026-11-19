# Conductor and working sessions

Status: C1–C3 implementation and action/model-adapter regression checks complete. Direct provider capability smoke passed; the broader interactive provider matrix remains explicitly unverified. The interaction uses one chat plus the requested compact three-layer task overview. Goals and teams are configured conversationally; working-session and process controls remain separate.

Sources: [coordinator](../../server/coordinator.mjs), [actions](../../server/conductor-actions.mjs), [schema](../../server/conductor-schema.json), [instructions](../../server/coordinator-instructions.md), [working sessions](../../server/work-sessions.mjs), [API](../../server/index.mjs), [Conductor tests](../../test/conductor.test.mjs), [scope tests](../../test/work-sessions.test.mjs).

## Graph as the main agent workspace

[Agent graph](../../src/session-graph.mjs) is the primary navigation, separate from the detailed System graph under More. It uses [session signals](../../shared/session-signals.mjs) to distinguish process state from work, questions, blockers, recent turn/task completion and missing evidence. [Provider observations](../../server/session-observation.mjs) use bounded native records; no model call is required. Unanswered structured questions persist until an answer; asynchronous tool acknowledgment is not an answer. Questions detected in final reply text are explicitly tentative. Managed helpers and provider-recorded native children connect to their exact parent; matching folders never establish parenthood. Native children without a terminal open saved output.

[Graph tests](../../test/session-graph.test.mjs), [signal tests](../../test/session-signals.test.mjs) and the [native harness](../../scripts/test-native-ui.mjs) cover filter context, state transitions, parent relationships and direct terminal input. Provider-internal prompts or children absent from supported metadata remain unknown. An observed finished turn is not proof of project completion.

## C4 — System transparency and terminal coordination

**Implemented in the working tree.** [Graph projection](../../shared/system-graph.mjs), [graph view](../../src/system-graph.mjs) and [styles](../../src/system-graph.css) connect observed agents, ordinary terminals, provider services, projects, teams, tasks, human sessions, Conductor, current provider operations, action receipts, browsers and background services. Message edges retain direction and queued/fetched/acknowledged states. Selection opens an inspector with source details, reports, evidence, messages and direct conversation/terminal navigation. The sidebar reports current Conductor activity even when its chat is hidden. A separate composer is unnecessary for inspection.

Conductor exposes its current phase and action timestamps. The graph shows provider-visible events, not hidden reasoning. Partial/failed/uncertain receipts remain distinct from completed actions; process and task status remain separate. New managed provider launches retain the exact application-supplied prompt, including whether it resumes an older conversation. Existing agents with no captured prompt retain an explicit gap, with the current mission labelled separately. Saved output is fetched only for the selected agent and discloses paging and potential lag.

[Transport observations](../../server/agent-activity.mjs) record safe request metadata without bodies or credentials. MCP is a per-agent stdio adapter through the authenticated local bridge, not a permanently connected global daemon. Contact observations reset on service restart and do not prove process liveness. The scoped `st_graph` includes MCP and Conductor; `st_conductor` returns loop availability and only the calling agent's sent messages. Startup prompts and MCP workflows explain terminal-based task reporting and coordination. Agent messages remain task data and cannot start an owner chat, resume a paused loop, expand authority or expose global owner history.

**Verification.** [Graph model](../../test/system-graph.test.mjs), [browser interactions](../../test/system-graph-ui.test.mjs), [real MCP transport](../../test/mcp.test.mjs) and [native harness](../../scripts/test-native-ui.mjs) cover the implemented boundaries. See the verification record for actual runs and installation status.

**Limits.** The graph covers observed inventory in the selected environment, not universal OS process enumeration. Empty projects and large inventories disclose hidden counts with expansion. Message and activity windows are bounded and disclose omissions. Original prompts for previously launched/external agents, unavailable logs and provider-internal instructions cannot be reconstructed. Full owner-level control from an ordinary agent's MCP credential is intentionally unavailable; its existing project/team authority remains unchanged.

## Direct execution and session configuration

**Implemented.** [Runtime adapter](../../server/conductor-runtime.mjs) separates direct chat from background coordination. Manual chat retains native Codex config, rules, coding instructions, shell/file tools and configured skills/plugins. Its default is full local file access; workspace-write and read-only are selectable. [Session controls](../../src/conductor-settings.mjs) save model, reasoning, access and skill preference separately for each working session, with independent no-session defaults. Each turn freezes and records its runtime across action rounds. No new working session is required. Owner chat uses the global local working directory regardless of the focused project. Project dispatch uses the destination project directory with direct tools disabled; remote project paths are never interpreted locally. Catalog discovery uses Codex config/read, model/list and skills/list without a model call.

**Verification and limits.** [Runtime tests](../../test/conductor-runtime.test.mjs), [API integration](../../test/integration.test.mjs) and [renderer fixture](../../test/work-ui.test.mjs) cover configuration isolation, validation, persistence, model/capability snapshots, native flags, selection and skill insertion. An isolated local provider smoke invoked a disposable skill, wrote a file and read it back. This does not establish every installed plugin, remote environment or model combination. Direct tools run under the selected OS access; platform provenance checks are not a filesystem sandbox. Background rounds and automatic briefings retain disabled direct tools and their existing action guards.

## C1 — Consistent projects, scope, and chat controls

**Implemented.** Canonical tasks retain legacy goal IDs, nested projects link through `canonicalProjectId`, and launch resolution validates project/team/task/scope before choosing host/cwd. Topic parsing preserves unambiguous remote host/owner evidence. Chat can create/update tasks and goals, rename agents, and edit/brief/add members to teams. Carry-forward retains source IDs. See `tasks.mjs`, `work-sessions.mjs`, `conductor-actions.mjs` and their tests.

**Implemented remedy.** Shared project mutations append session topics and edit title/notes/location/status through chat and HTTP. Canonical links stay synchronized; remote paths are not validated locally. Existing process assignments do not move their actual working directory automatically.

Conductor keeps one global owner conversation, memory and inventory. Project/task/agent navigation supplies focus identities, not a conversation boundary. The API enters through `askOwner`; internal background project rounds remain partitioned. Agent-facing actions route through a fresh, tool-disabled project invocation using the current direct owner request, validated destination identities and project-only evidence. The global draft, memory, receipts, sibling project content and owner conversation are excluded. A route is not authorization; missing input is returned without mutation. Destination and existing privacy guards are checked before execution. Creation requests of the same type and project are grouped to avoid both duplicate launches and dropped requested items. Each outer action round still permits at most four executed actions, including dispatched actions. Nested receipts retain failures and uncertain restart outcomes. Project/session creation keeps its separate clean owner-intent interpretation; a created project can become the next focus while the owner conversation remains global. [Dispatch regressions](../../test/conductor-dispatch.test.mjs) cover these boundaries with synthetic data; installed-app and provider-backed acceptance for this change remain unverified.

**Implementation contract.**

Saved team rosters are included in project-filtered snapshots, with bounded role/task fields and disclosed roster coverage. Activating an existing team can therefore use its stored roles without copying a global draft into the project dispatch. Saved records remain task evidence, not launch authority; the current owner request must authorize activation. The existing-team dispatch regression verifies all four fixture roles and excludes another project's roster and owner memory.

- Define the relationship between a persistent project and its working-session instance. Preserve both concepts, but give them distinct identifiers or a validated link so the same `projectId` field cannot ambiguously mean either.
- Resolve launch location from explicit input, then the selected scoped project/team, then the selected environment's default. Reject conflicting scope and host information; ask in chat when the user's location is ambiguous.
- Preserve history host and owner evidence when suggesting project locations. Do not validate a remote path as a local directory.
- Add the missing chat actions needed to append/update session projects and goals, edit their titles/notes/location, and reassign work at session/project/goal layers. Share validators and mutations with HTTP routes.
- Preserve carry-forward links to the source work while giving the new session its own goal IDs. Do not silently transfer running agents to new scope.
- Keep project management as metadata for existing folders. Repository creation/deletion is outside this control surface.

**Dependencies.** P3 defines migrations for persisted records. T2 uses stable project/team/scope identity. D2 supplies location evidence.

**Acceptance.** A chat-only flow can start a session from broad topics, add a topic, correct a project location, launch agents at every layer, update a goal, and carry unfinished goals forward. A scoped remote launch uses that remote environment and directory without repeated manual location input. Invalid cross-session/project/goal combinations cause no mutation. Existing stored sessions migrate without dropping notes or assignments.

## C2 — Human-session lifecycle and grounded progress

**Implemented.** The window header identifies the working session and explicitly says agents continue after human-session pause/stop. Managed process controls are separate and retain partial results. Canonical tasks drive the project squares, table and details. Shared validation requires completion evidence from chat, API and helper reports and records attribution.

**Implemented / limits.** Wrap summaries retain actor-reported completion, missing evidence, recent conflicting reports, independent process observations and unresolved handoffs. They do not rerun tests. Explicit manual bulk controls enumerate existing assigned targets, return per-target outcomes, preserve failures and cap each request at 50 targets. Wrapping/pausing human work does not control processes implicitly.

**Implementation contract.**

- Give Conductor an explicit compact overview input/output contract: active human session, projects/goals, assigned agents with separate process status, verification notes, blockers, and unresolved questions.
- Route human-session state changes and agent process controls through distinct actions. When the user requests pausing/stopping the assigned agents too, enumerate targets and report individual results through T3; do not silently equate wrap-up with process termination.
- Share goal progress validation across chat, API, and helper paths. Require a completion note consistently and preserve who reported it. A note is evidence supplied by an actor, not proof that the platform reran tests.
- On requested consolidation or wrap-up, reconcile recorded progress with available recent agent messages/history. Keep conflicts and missing evidence visible, and ask a short question where a conclusion cannot be grounded.
- Preserve unfinished goals, blockers, handoff notes, and source references when carrying work. Archived/wrapped work must remain readable.

**Dependencies.** C1 provides consistent hierarchy. T3 provides process lifecycle results. D2 provides coverage metadata; T2 provides attributable mailbox evidence.

**Acceptance.** An overview distinguishes a live idle process, an open task, a completed response, and a completed goal. Wrapping alone leaves agents running. An explicit request to pause assigned agents reports which were paused, unsupported, or failed. Every completion entry point rejects missing evidence. Wrap-up and carry-forward preserve unresolved work without certifying uncertain work as done.

## Saved conversation retrieval and project reconciliation

Project history now uses classified saved records instead of only histories attached to live processes. Scoped title/path search and transcript excerpt pagination preserve project provenance; task and autonomous reads remain narrow. `read_conductor_history` retrieves bounded earlier direct exchanges from the same project context, while the global overview can read all direct exchanges. Omission is disclosed and is not treated as inaccessible history. Older retrieval receipts yield to recent evidence within the input cap. [History tests](../../test/conductor-history.test.mjs) exercise these paths without model calls.

Owner API project edits retain old path aliases. Explicit consolidation accepts only duplicate records without managed agents, tasks, teams or working-session topics. The source record and original histories remain, classification resolves its folders to the canonical project, and automatic discovery does not recreate the duplicate. This is tracking reconciliation, not a Git merge or filesystem move. [Reconciliation tests](../../test/project-reconciliation.test.mjs) cover preservation and refusal of active assignments.

## C3 — Bounded context, usage, and action accounting

**Implemented.** Continuous collection uses no model. New reports, provider completion observations, changed work and focus trigger paced decisions; unchanged work stays listening without model calls. Decisions route through project partitions, with a global owner overview kept separate. Completion observations never directly mark tasks done. The loop persists run/pause/stop intent, backs off failures, and permits one reply at once. Input is capped at 24,000 bytes with omission counts; round usage is aggregated. Action results, context-bound duplicate receipts, cancellation state and provider-visible trace events persist. `conductor-policy.mjs` rechecks fresh active scope before autonomous mutations. Optional first briefings remain read-only. Quitting the service stops this loop; it is not an operating-system daemon.

Response instructions request concise Markdown: the result first, normally 40–100 words or fewer, only material evidence/blockers/next steps, and one progress sentence during action rounds. Important uncertainty is retained; there is no hard truncation by word count. Bold, inline code and one optional highlight emphasize useful information. This is generation guidance; actual word/token savings and adherence require a provider-backed evaluation.

**Remaining gap.** The byte cap is not an exact token count or billing cap. Each mutating action persists a started receipt before its effect. Restart changes unfinished receipts to uncertain and prevents blind replay; successful intentional manual repeats remain possible. A snapshot/restart regression verifies no duplicate effect. This remains conservative recovery, not a distributed transaction. Provider-authenticated, remote and long-running acceptance are separate from fake-model tests.

**Implementation contract.**

- Apply a total context budget with deterministic priorities: current user request, selected scope, active work, unresolved questions, relevant messages, and a bounded history-review batch. Include omitted counts and a direct retrieval path.
- Aggregate available usage across every model round and retain round/action counts with the turn. Do not estimate provider billing from incomplete telemetry or add a usage dashboard.
- Persist an action ledger with proposed/executed/failed/not-run results. Bound model calls and mutations explicitly. Prevent duplicate launches on retries using operation identity or reconciliation.
- On cancellation, failure, or action limit, report executed actions and untouched requests. Cancellation stops the current model request; it must not imply rollback of completed platform operations.
- Include enough mailbox attribution to identify sender, recipient, team/scope, and unread state. Keep agent content as untrusted evidence.
- Test automatic-briefing read-only enforcement, malformed structured responses, injected instructions in transcripts, duplicate action proposals, partial failures, and coverage rotation with a fake CLI/model adapter.

**Dependencies.** C1/C2 define the useful overview. D2 defines evidence quality. T1/T3 provide reconcilable operation results.

**Acceptance.** Large fixture inventories stay within the chosen input cap and expose omitted coverage. One user request cannot run duplicate launches through a model retry. Usage covers all available rounds. Automatic briefings cannot mutate state. Cancellation and limits leave a readable ledger of completed and unexecuted work. Ordinary discovery and inbox storage make no model calls; a separate enabled decision round may consume the collected changes within its cadence and active-scope limits.

### Isolated-team coordination

Owner chat can create a team and configure its runtime before launch. Automatic rounds cannot broaden the runtime grant. Agents request bounded helpers through `st_request_helper`; requests are task data that consume an existing owner grant. The System graph shows per-agent runtime nodes, helper edges and observed team gateway services, with links to Runtime and native terminals. See [the runtime contract](isolated-teams.md) and [checks](../verification.md#isolated-team-runtime-verification).
