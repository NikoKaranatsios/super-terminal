# Browsers and runtime isolation

Status: B1 host-profile behavior remains implemented. B2 now includes owner-selected container execution with an in-container browser; see [isolated teams](isolated-teams.md) for the access contract, persistence, UI and outstanding provider/SSH/runsc acceptance.

Sources: [browser manager](../../server/browsers.mjs), [helper](../../server/bridge.py), [startup instructions](../../server/agent-platform.mjs), [agent endpoint](../../server/index.mjs), [browser integration checks](../../test/integration.test.mjs).

## B1 — Browser lifecycle and concurrent commands

**Implemented.** Each managed ID owns a headless persistent profile and a command queue. Separate agents remain independent. Close waits for pending launch/commands; page/context loss and popups update the usable page. Missing executables produce an actionable error. Profiles are retained after stop; a fresh managed ID gets a separate profile. Remote screenshot bytes were verified on both approved servers. Queue/page/close fixtures and real browser profile/redirect/URL-boundary integration pass.

**Implementation contract.**

- Define serialization and cancellation for commands within one agent while keeping separate agents independent. Handle a page or context closing during a command, popups, and context-launch failure.
- Coordinate browser close with pending creation so cleanup cannot return while an untracked browser is still starting. Use T3's shared lifecycle primitives for stop/removal/failed launch.
- Specify profile retention and reuse on stop, resume, and cleanup. Do not delete cookies/storage as an incidental side effect or silently share a profile between agents.
- Verify executable discovery and actionable behavior when neither a configured browser nor a usable Playwright browser is installed.
- Exercise a remote helper end to end: browser runs on the local service machine; screenshot bytes are returned through the bridge and saved on the requesting agent's machine.

**Dependencies.** T1/T3 define session creation/cleanup. T2 supplies remote bridge recovery.

**Acceptance.** Concurrent agents retain separate cookies/storage. Overlapping commands for one agent have deterministic outcomes. Closing/removing an agent leaves no unintentionally running context, including pending launches. Missing browser/page errors are readable. Remote screenshots are usable from the remote agent without opening personal tabs.

## B2 — Owner-selected execution boundary

Host mode keeps the existing browser-profile boundary: headless persistent profiles, downloads/service workers disabled, HTTP(S)-only opening and control-service rejection, including redirects and WebSockets. It does not isolate the host shell or same-user files. Remote host-mode browsers run on the local service machine.

The owner selected stronger isolation. Container teams now use a private volume and Chromium browser per agent, an internal team network, restricted/offline egress, explicit resource limits and a scoped stdio bridge. Existing host agents are not migrated. Docker and native Electron checks are recorded separately in [verification](../verification.md#isolated-team-runtime-verification).

The [isolated-team plan](isolated-teams.md) is the implementation contract for B2 and T4. It identifies the shared-kernel boundary, provider sign-in, retained files, export, helper authority and remaining acceptance. No browser-profile claim substitutes for an OS boundary, and Linux browser checks do not establish native macOS behavior.

Redirect routing alone does not cover later hops; see [Playwright redirect semantics](https://playwright.dev/docs/network#redirects). Actual Chromium tests cover multi-hop redirects, popup navigation and control WebSockets, including the server-side marker rejection.
