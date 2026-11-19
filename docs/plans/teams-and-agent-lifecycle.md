# Teams and agent lifecycle

Status: T1–T3 implementation complete with local integration and actual approved remote shell/bridge checks. Full interactive provider acceptance remains separate. Keep coordination in Conductor chat, the compact Teams view, and readable Team messages. The requested continuous loop may launch within user-authorized active scope; peer text alone never grants launch permission.

Sources: [agent platform](../../server/agent-platform.mjs), [Python helper](../../server/bridge.py), [API/session creation](../../server/index.mjs), [Conductor actions](../../server/conductor-actions.mjs), [scope/communication rules](../../server/work-sessions.mjs), [integration tests](../../test/integration.test.mjs).

## T1 — Launch readiness and recoverable partial teams

Managed provider launches retain the exact application-supplied initial prompt in private session metadata. The graph distinguishes this from the mutable assigned mission and explicitly marks old/external prompt gaps. MCP/startup instructions explain `st_conductor` and scoped terminal conversation workflows; they do not expose owner history or add process authority. [C4](conductor-and-sessions.md#c4--system-transparency-and-terminal-coordination) records the graph and transport boundary.

**Implemented remedy.** Launch preflight checks cwd, executable, Python, tmux and permitted remote owner before credentials are prepared. Remote managed launches require tmux. Transport, CLI-running, recovery-shell and unknown states are distinct. Failed-launch rollback uses the shared lifecycle, returns partial resource outcomes and retains unresolved records. Team role locks retain successful members and retries launch only missing roles. CLI authentication/task acceptance still requires provider evidence.

**Implementation contract.**

- Preflight the selected folder, provider, Python helper, tmux availability, and allowed SSH account without changing login/permission policy. Return capability gaps in the existing chat/terminal surface.
- Distinguish transport created, CLI running, recovery shell, and failed launch. Do not claim provider authentication or task acceptance solely because tmux exists.
- Clean up only resources owned by a failed launch. Keep successful team members and list failed roles with their exact cause. A retry should start missing roles without duplicating successful ones.
- Verify each provider receives the intended task, default prompt, role, scope, and helper environment on both new and resumed sessions.
- Make the remote persistence fallback explicit; decide whether to require tmux for managed remote sessions rather than promise survival for a non-tmux command.

**Dependencies.** D3 establishes provider arguments. C1 establishes scope/location resolution. T3 owns rollback/resource cleanup.

**Acceptance.** Missing CLI, missing directory, SSH failure, bridge-port collision, login requirement, and partial team launch produce truthful results. A successful tmux creation is not mistaken for an operational provider. Retrying a partially created team does not spawn duplicate roles. Failed launch credentials/resources are not left active unintentionally.

## T2 — Team membership, delivery, and bridge recovery

**UI implementation.** Team conversations have team and text filters, formatted message bodies, sender/recipient links, timestamps, explicit delivery states and a composer addressed to one available member. The recipient list uses explicit team IDs; current-ID messages from a same-named different team are excluded. Existing legacy group views remain owner-readable. Sending uses the existing validated agent prompt endpoint and does not broadcast. Failed or in-flight sends retain drafts, including a newer draft typed while an earlier message is being queued. Fixture tests verify focus, recipient boundaries and draft restoration; they do not claim provider acceptance from queueing.

**Implemented.** Peer sharing requires explicit team IDs. Neither equal labels/folders nor shared human sessions grant access. Context files use project/team/agent ID keys; legacy label-keyed files are retained without automatically exposing them. Messages bind to recipient project, team and assignment revision; stale queued messages are withheld. Reads record fetched status, not acceptance. Source-project IDs persist with shared task reports and messages, so removing an agent does not erase their origin. Project moves and leaving teams preserve the process but suspend platform context; use a fresh agent for the new boundary.

**Implemented / limits.** Fetching marks read; a separate idempotent acknowledgment requires the current recipient to have fetched a still-visible message. This is not task completion. Reconnect verifies the original remote tmux session, restores loopback forwarding and its per-agent helper, and never starts another provider. Both approved remote checks passed fetch/ack, loss/reconnect, no duplicate agent and owned cleanup. Only managed agents have tools; API filtering cannot erase model memory or sandbox the operating-system account.

**Implementation contract.**

- Preserve stable team/project identity and explicit sharing. Keep old unscoped messages/context owner-readable without automatically granting agent access; any migration must retain provenance.
- Share assignment mutations across Conductor and API. Queue a scope/mission handoff when an enrolled agent changes assignment and preserve current work until the agent handles the message.
- Expose existing team mission update, briefing, and adding members through validated chat actions. Keep team size bounded and partial results visible.
- Represent queued, fetched, and acknowledged states accurately. Do not claim a queued message was delivered into a running CLI's prompt. Add acknowledgment only if the agent has actually sent it; no keystroke injection.
- Provide a deterministic bridge health/reconnect path for existing managed remote agents. Re-establish loopback forwarding without launching another provider or exposing the control port publicly. Handle collisions and revoked/stale credentials.
- Test mailbox scope, reassignment, duplicate reads, service restart, concurrent send/read, and bridge loss. Keep any reminder mechanism model-free unless the user explicitly asks Conductor to respond.

**Dependencies.** C1 provides scope identity. T1/T3 provide session ownership and credential lifecycle. P3 provides migrations.

**Acceptance.** Two unrelated projects with the same folder name do not automatically become team peers. Reassignment sends one accurate handoff. Users can read both sides of an exchange and distinguish queued/read/acknowledged states. SSH recovery restores helper access without duplicating an agent. Out-of-scope messages/progress are rejected. Polling and task recording use no model calls; the separate continuous decision loop observes eligible changes within its bounded cadence.

**Constraint/decision.** An external process may be tracked and grouped without being enrolled. If external tool enrollment is added, make it an explicit opt-in handoff using the existing CLI, not silent credential injection or a promise to adopt its live TTY. The existing managed-resume path remains available.

## T3 — Unified pause, stop, deletion, and cleanup

**Implemented.** `lifecycle.mjs` unifies Conductor controls, direct controls, DELETE and cleanup. Stop revokes enrollment, attempts owned remote/local process cleanup, closes browser resources and removes credentials. Failures retain a record with per-resource outcomes. Foreground groups are rechecked; external signals require executable/start identity. Paused jobs are resumed before termination. Tests include test-owned processes, revoked tokens and mocked remote failure.

**Verification / limits.** Local integration, remote identity fixtures and both approved remote shell cleanup checks pass. Helpers are owned per agent; cleanup removes exact credentials/helper files, revokes tokens and closes browsers while retaining profiles/history/projects. Full provider/remote-owner acceptance remains broader than these checks; tmux creation alone does not prove provider readiness.

**Implementation contract.**

- Define shared operations: detach a view, pause/resume a foreground job, stop a managed agent, remove a stopped record, and purge app-owned resources. Keep them separate from deleting provider histories or project files.
- Centralize local/remote process selection and identity validation. Account for process groups, paused jobs, remote ownership, transport loss, and permissions. Shared provider runtimes remain uncontrollable through these actions.
- Specify the fate of helper tokens, browsers, profile data, credential files, assignments, lifecycle entries, and tunnels for each operation. Revoke access when enrollment ends; retain desired readable history and user-owned files.
- Have Conductor, DELETE, cleanup, and failed-launch rollback call the same primitives. Make repeated calls safe and return per-resource results rather than silently swallowing incomplete cleanup.
- On lost SSH, distinguish stopping the local recovery shell from stopping a still-running remote agent. Do not report remote termination without evidence.

**Dependencies.** D1 supplies process identity/health. T1 supplies ownership of launch resources. B1 shares browser cleanup. P3 supports persisted state changes.

**Acceptance.** Detached views leave jobs alive. Pause/resume/stop affect only the intended foreground job. Paused remote agents can be stopped correctly. Repeated cleanup is safe and preserves provider history/project files. Removed agents cannot use old tokens; their browser processes/tunnels are handled according to the documented operation. Remote failure yields a partial result instead of a false success.

## T4 — Isolated teams and managed helpers

Implemented in source: explicit owner runtime grants, private agent containers/homes, stable helper request receipts, inherited project/team context, launch/capacity/depth bounds, serialized launch/stop, retained-volume export and partial cleanup reporting. Existing host teams remain supported. The [isolated-team contract](isolated-teams.md) defines access and remaining acceptance; [verification](../verification.md#isolated-team-runtime-verification) distinguishes real Docker/API/native checks from provider and SSH acceptance.
