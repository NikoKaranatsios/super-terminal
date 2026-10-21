# Conductor and working sessions

Status: partial implementation; C1–C3 remain open. The interaction uses one chat plus the requested compact three-layer task overview. Goals and teams are configured conversationally; working-session and process controls remain separate.

Sources: [coordinator](../../server/coordinator.mjs), [actions](../../server/conductor-actions.mjs), [schema](../../server/conductor-schema.json), [instructions](../../server/coordinator-instructions.md), [working sessions](../../server/work-sessions.mjs), [API](../../server/index.mjs), [Conductor tests](../../test/conductor.test.mjs), [scope tests](../../test/work-sessions.test.mjs).

## C1 — Consistent projects, scope, and chat controls

**Implemented.** Canonical tasks retain legacy goal IDs, nested projects link through `canonicalProjectId`, and launch resolution validates project/team/task/scope before choosing host/cwd. Topic parsing preserves unambiguous remote host/owner evidence. Chat can create/update tasks and goals, rename agents, and edit/brief/add members to teams. Carry-forward retains source IDs. See `tasks.mjs`, `work-sessions.mjs`, `conductor-actions.mjs` and their tests.

**Remaining gap.** Direct editing of a nested project location through chat and complete migration validation of every legacy shape still need acceptance. Existing process assignments do not move their actual working directory automatically.

**Implementation.**

- Define the relationship between a persistent project and its working-session instance. Preserve both concepts, but give them distinct identifiers or a validated link so the same `projectId` field cannot ambiguously mean either.
- Resolve launch location from explicit input, then the selected scoped project/team, then the selected environment's default. Reject conflicting scope and host information; ask in chat when the user's location is ambiguous.
- Preserve history host and owner evidence when suggesting project locations. Do not validate a remote path as a local directory.
- Add the missing chat actions needed to append/update session projects and goals, edit their titles/notes/location, and reassign work at session/project/goal layers. Share validators and mutations with HTTP routes.
- Preserve carry-forward links to the source work while giving the new session its own goal IDs. Do not silently transfer running agents to new scope.
- Keep project management as metadata for existing folders. Repository creation/deletion is outside this control surface.

**Dependencies.** P3 defines migrations for persisted records. T2 uses stable project/team/scope identity. D2 supplies location evidence.

**Acceptance.** A chat-only flow can start a session from broad topics, add a topic, correct a project location, launch agents at every layer, update a goal, and carry unfinished goals forward. A scoped remote launch uses that remote environment and directory without repeated manual location input. Invalid cross-session/project/goal combinations cause no mutation. Existing stored sessions migrate without dropping notes or assignments.

## C2 — Human-session lifecycle and grounded progress

**Implemented.** The sidebar identifies the working session and explicitly says agents continue after human-session pause/stop. Managed process controls are separate and retain partial results. Canonical tasks drive the project squares, table and details. Shared validation requires completion evidence from chat, API and helper reports and records attribution.

**Remaining gap.** Wrap summaries use reported state; they do not independently verify tests. Explicit bulk agent-control requests still execute as bounded individual actions. Conflicting evidence can be discussed by Conductor, but there is no general evidence-merging engine.

**Implementation.**

- Give Conductor an explicit compact overview input/output contract: active human session, projects/goals, assigned agents with separate process status, verification notes, blockers, and unresolved questions.
- Route human-session state changes and agent process controls through distinct actions. When the user requests pausing/stopping the assigned agents too, enumerate targets and report individual results through T3; do not silently equate wrap-up with process termination.
- Share goal progress validation across chat, API, and helper paths. Require a completion note consistently and preserve who reported it. A note is evidence supplied by an actor, not proof that the platform reran tests.
- On requested consolidation or wrap-up, reconcile recorded progress with available recent agent messages/history. Keep conflicts and missing evidence visible, and ask a short question where a conclusion cannot be grounded.
- Preserve unfinished goals, blockers, handoff notes, and source references when carrying work. Archived/wrapped work must remain readable.

**Dependencies.** C1 provides consistent hierarchy. T3 provides process lifecycle results. D2 provides coverage metadata; T2 provides attributable mailbox evidence.

**Acceptance.** An overview distinguishes a live idle process, an open task, a completed response, and a completed goal. Wrapping alone leaves agents running. An explicit request to pause assigned agents reports which were paused, unsupported, or failed. Every completion entry point rejects missing evidence. Wrap-up and carry-forward preserve unresolved work without certifying uncertain work as done.

## C3 — Bounded context, usage, and action accounting

**Implemented.** Continuous collection uses no model. Eligible work changes and active unfinished work trigger paced decisions; empty/unchanged completed scopes stay listening without model calls. The loop persists run/pause/stop intent, backs off failures, and permits one reply at once. Input is capped at 24,000 bytes with omission counts; round usage is aggregated. Action results, duplicate receipts, cancellation state and provider-visible trace events persist. `conductor-policy.mjs` rechecks fresh active scope before autonomous mutations. Optional first briefings remain read-only.

**Remaining gap.** The byte cap is not an exact token count or billing cap. Crash recovery of an action between its external effect and receipt remains conservative, not a distributed transaction. Provider-authenticated, remote and long-running acceptance are separate from fake-model tests.

**Implementation.**

- Apply a total context budget with deterministic priorities: current user request, selected scope, active work, unresolved questions, relevant messages, and a bounded history-review batch. Include omitted counts and a direct retrieval path.
- Aggregate available usage across every model round and retain round/action counts with the turn. Do not estimate provider billing from incomplete telemetry or add a usage dashboard.
- Persist an action ledger with proposed/executed/failed/not-run results. Bound model calls and mutations explicitly. Prevent duplicate launches on retries using operation identity or reconciliation.
- On cancellation, failure, or action limit, report executed actions and untouched requests. Cancellation stops the current model request; it must not imply rollback of completed platform operations.
- Include enough mailbox attribution to identify sender, recipient, team/scope, and unread state. Keep agent content as untrusted evidence.
- Test automatic-briefing read-only enforcement, malformed structured responses, injected instructions in transcripts, duplicate action proposals, partial failures, and coverage rotation with a fake CLI/model adapter.

**Dependencies.** C1/C2 define the useful overview. D2 defines evidence quality. T1/T3 provide reconcilable operation results.

**Acceptance.** Large fixture inventories stay within the chosen input cap and expose omitted coverage. One user request cannot run duplicate launches through a model retry. Usage covers all available rounds. Automatic briefings cannot mutate state. Cancellation and limits leave a readable ledger of completed and unexecuted work. Ordinary discovery and inbox storage make no model calls; a separate enabled decision round may consume the collected changes within its cadence and active-scope limits.
