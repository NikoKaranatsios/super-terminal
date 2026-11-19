# Isolated teams and bounded helpers

The owner selected Linux containers with browsers and managed agent delegation. This is implemented in the working tree. It does not migrate existing host agents or the installed personal workspace. [Verification](../verification.md#isolated-team-runtime-verification) separates source, Docker, native UI and unverified environments.

## Execution and access

Each team has an internal Docker network. Each agent has its own container, named volume, Git checkout, home, provider login and Chromium profile. Only committed `HEAD` is copied through a Git bundle; original working copies and uncommitted changes stay untouched. There are no host bind mounts, host login imports, published ports or Docker socket mounts. Platform requests use an agent-local spool and a host-controlled stdio broker; the owner credential remains outside the container.

Containers run as UID/GID 1000 with a read-only root, all capabilities dropped, no new privileges, bounded CPU/memory/processes and temporary filesystems. Chromium keeps its own sandbox enabled with the attributed [seccomp profile](../../runtime/NOTICE.md). Linux containers share the Docker host kernel. Optional `runsc` requires an existing compatible Docker runtime; availability is checked and there is no silent fallback.

Networking is either team-only or an exact public DNS allowlist through a dedicated gateway. The gateway validates and pins the resolved IPv4 address, rejects private/reserved destinations, and accepts HTTP/HTTPS ports only. Team members can reach explicitly shared team services. DNS and authorized destination traffic are not a general data-loss prevention boundary. Provider authorization and native CLI approvals remain in effect.

The default image contains Codex and Claude, Python, Git, tmux and Chromium. Sign in inside the private runtime terminal. Grok requires an owner-selected compatible image containing its CLI; launch preflight reports it missing. Images must provide the runtime files and a workspace writable by UID 1000. Image construction sends only selected runtime source, never the complete project or personal state, to Docker.

Sources: [policy](../../server/sandbox-policy.mjs), [runtime manager](../../server/sandbox-runtime.mjs), [image builder](../../server/sandbox-image.mjs), [image](../../runtime/Dockerfile), [runner](../../runtime/runner.mjs), [gateway](../../runtime/egress.mjs), [scoped broker](../../runtime/broker.mjs).

## Delegation authority

Configure a team in Conductor. Only a direct owner action may configure its runtime or enable helpers. An agent calls `st_request_helper` with a stable request ID, role and task. The helper inherits its parent's project, explicit team, environment and runtime grant. It starts with fresh context and a private workspace; no parent transcript or unrelated project context is copied.

The default grant permits four concurrent agents, twelve cumulative launches, and depth one; helpers are disabled until enabled. Bounds are validated, failed launches consume the allowance, concurrent requests serialize, and receipts persist before launch. Reusing an ID returns the original receipt. Interrupted effects are recorded as uncertain instead of retried blindly. Assignment/revision changes, revoked parents and exhausted limits reject new helpers.

Changing a grant requires stopped agents and released runtime services. A new grant does not reset cumulative launches. Unconfirmed stop failures still reserve concurrent capacity even after platform access is revoked. Team stop serializes with provisioning, revokes platform credentials, reports partial failures and permits cleanup retries. Ordinary app shutdown only disconnects the broker and terminal views.

These limits govern platform-managed helpers. A provider's native internal workers share the same container limits but are not counted as separate platform agents. There is no hard provider billing quota or persistent-volume disk quota. Normal Conductor model/action accounting remains separate.

Sources: [helper requests](../../server/delegation.mjs), [owner actions](../../server/conductor-actions.mjs), [MCP tools](../../server/mcp.mjs), [launch and endpoints](../../server/index.mjs), [state validation](../../server/state-schema.mjs).

## Interface and recovery

Teams shows missions, named members, process states, helper lineage, launch/capacity limits, network/resource policy and partial outcomes. Configuration opens a Conductor draft. Runtime details link to the native terminal and System graph, provide pause/resume/stop and patch export, and show the agent's actual in-container browser preview. Controls remain usable in narrow panels; URLs and in-flight states survive inventory refresh.

Stopping removes owned containers and team network services while retaining agent volumes. Export creates a binary Git patch from the captured source, including committed and saved uncommitted/untracked work. It briefly pauses a running container for consistency and uses a separate index/object directory, preserving the agent's index and checkout. Review and apply exported work explicitly; no automatic host write, merge or push occurs. Provider homes and profiles remain in the retained volume, but reopening a stopped provider conversation from that volume is not implemented.

Sources: [Teams](../../src/work-views.mjs), [runtime UI](../../src/runtime-view.mjs), [styles](../../src/runtime.css), [System graph](../../shared/system-graph.mjs), [lifecycle](../../server/lifecycle.mjs).

## Remaining acceptance and dependencies

| Item | Required evidence / dependency |
| --- | --- |
| Provider authentication and native commands | Explicit disposable login in the private container; verify interactive Codex/Claude startup, approvals, MCP and allowed authentication destinations. Shell acceptance does not establish provider compliance. |
| SSH Docker environments | Available Docker/image on an already approved SSH target; repeat launch, broker interruption, browser, export and retained-volume checks. Never add a destination to make tests pass. |
| gVisor | Existing compatible `runsc`; verify the selected image, Chromium, tmux, network and export with that engine. Selection/preflight alone does not establish runtime acceptance. |
| Installed personal app | Reconcile the existing legacy/Markdown workspace conflict through the separate recovery workflow before replacing the installed app. This work does not approve a state migration. |
| Stronger limits or provider-history reopening | Separate product decisions and acceptance criteria are required for billing enforcement, disk quotas, native provider worker accounting and stopped-conversation restoration. Existing files remain retained. |

Linux browser acceptance is separate from native macOS app acceptance. Neither shell tests nor container screenshots verify provider output, personal integrations, OS notification banners or all native window behavior.
