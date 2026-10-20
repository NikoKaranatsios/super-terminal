# Browsers and runtime isolation

Status: profile isolation is implemented; B1 lifecycle acceptance and B2 boundary verification remain open. Stronger execution isolation is a decision, not an implemented feature.

Sources: [browser manager](../../server/browsers.mjs), [helper](../../server/bridge.py), [startup instructions](../../server/agent-platform.mjs), [agent endpoint](../../server/index.mjs), [browser integration checks](../../test/integration.test.mjs).

## B1 — Browser lifecycle and concurrent commands

**Current behavior/gap.** A managed agent gets a headless persistent Chromium profile keyed by session ID. Browser creation is deduplicated by a pending promise. Commands use the current page; newly opened pages replace that pointer. There is no per-agent command queue or tab-selection tool. Closing during a pending launch and session cleanup are not covered by existing tests. A new managed resume receives a new session ID/profile rather than necessarily reusing the previous browser state.

**Implementation.**

- Define serialization and cancellation for commands within one agent while keeping separate agents independent. Handle a page or context closing during a command, popups, and context-launch failure.
- Coordinate browser close with pending creation so cleanup cannot return while an untracked browser is still starting. Use T3's shared lifecycle primitives for stop/removal/failed launch.
- Specify profile retention and reuse on stop, resume, and cleanup. Do not delete cookies/storage as an incidental side effect or silently share a profile between agents.
- Verify executable discovery and actionable behavior when neither a configured browser nor a usable Playwright browser is installed.
- Exercise a remote helper end to end: browser runs on the local service machine; screenshot bytes are returned through the bridge and saved on the requesting agent's machine.

**Dependencies.** T1/T3 define session creation/cleanup. T2 supplies remote bridge recovery.

**Acceptance.** Concurrent agents retain separate cookies/storage. Overlapping commands for one agent have deterministic outcomes. Closing/removing an agent leaves no unintentionally running context, including pending launches. Missing browser/page errors are readable. Remote screenshots are usable from the remote agent without opening personal tabs.

## B2 — Isolation boundary and optional stronger execution

**Current boundary.** Browser profiles are separate from personal profiles. Browsers are headless, reject downloads, block service workers, and block requests to the service's control port. Opening a page accepts HTTP(S). These controls do not isolate an agent's shell, filesystem, repository, network, or same-user secrets. Remote agents still execute their CLI on the selected SSH machine, while their platform browser executes locally.

**Work.**

- Add regression checks for profile separation, attempted control-page navigation/redirects, unsupported URL schemes, popup behavior, and credential separation between browser and management APIs.
- Keep prompts and help text precise about the boundary. Do not call the whole agent a sandbox or promise that browser profile separation prevents arbitrary shell access.
- If stronger isolation is selected, document a concrete threat boundary and required filesystem/network/tool access before choosing a container or OS mechanism. Identify how CLI logins, repositories, SSH, and isolated browsers would work without requiring broad permissions or personal browser state.

**Dependencies.** B1 supplies reliable context cleanup; T2/T3 supply bridge/token boundaries. OS isolation has no implementation commitment without a defined user need.

**Acceptance.** Tests demonstrate the existing browser/API boundary without touching personal profiles. Documentation distinguishes process location, profile isolation, and filesystem permissions. Any stronger sandbox implementation must have explicit access rules and tests; until then the limitation remains visible.
