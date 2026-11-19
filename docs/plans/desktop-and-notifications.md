# Desktop and notifications

Status: UX revisions and U1–U3 implementation complete. Fixture and native Electron checks pass within the recorded scope; OS focus/minimize/fullscreen and visible notification/click acceptance remain unavailable or unverified. Preserve the dark terminal style, small sidebar, and provider formatting. Fix interaction and evidence problems within existing views.

Sources: [renderer](../../src/app.js), [workspace model](../../src/workspace.mjs), [styles](../../src/style.css), [desktop main](../../desktop/main.cjs), [notification watcher](../../desktop/notifications.cjs), [activity monitor](../../server/activity.mjs), [workspace tests](../../test/workspace.test.mjs), [activity tests](../../test/activity.test.mjs).

## UI review completion

The System graph adds a workspace tab alongside Conductor. It supports pan/zoom, search/type/project filters, keyboard node selection, an inspector with direct conversation navigation, visible offline/source states and expansion for bounded inventories. Its dedicated browser fixture and isolated native Electron check are recorded under [System graph verification](../verification.md#system-graph-verification). Existing tab restoration, splits and separate windows apply to this view; no personal process is controlled by graph selection.

The Agent graph is the default workspace and primary navigation (⌘1), with Sessions on ⌘2. Clicking a node opens or reuses an adjacent terminal pane, retaining the graph and native xterm focus. Search, project focus, activity filters, pan/zoom and keyboard node traversal keep the overview navigable. The graph is a free node canvas with compact provider tiles, visible ports, curved project-to-agent connections and dashed parent/subagent connections. A deterministic left-to-right forest gives subtrees separate vertical space. Node dragging saves display positions per data workspace; it never changes project authority or parent relationships. Pointer/trackpad pan, cursor-anchored zoom, a minimap, Fit, 100% and Tidy up provide navigation. Large inventories initially retain readable node sizes. Arrow keys follow visible geometry and focus reveals offscreen nodes. Nodes show model, task, state, branch and question/activity previews. Details opens an inspector containing the full question, task reports, progress counts, paths and evidence age; inspecting a node does not open a terminal. Older saved subagents fold under their parent with an explicit count and expansion button; activity filters and search reveal matching children with parent context. Ordinary shells are one toggle away. Saved native children open saved output and cannot be mistaken for attachable terminals. Source uncertainty overrides activity badges. See [graph workspace evidence](../verification.md#agent-graph-workspace-verification).

The secondary Sessions screen lists live agents and shells across configured environments with project/task, provider/model, terminal identity, location and access. Search and an environment filter remain visible in the sidebar. Management, working-session controls, services, stopped sessions and history live under More. Unknown/disconnected sessions remain unverified. Interactive session activation focuses xterm immediately; there is no additional session input bar. Conductor and team conversations keep their own composers. Process and project controls remain in the session header disclosure.

Project/task/team search, environment/state filters, compact note excerpts, persistent agent/team/prompt drafts, failed-preference rollback, roving keyboard tabs and a narrow-screen navigation dialog have fixture coverage. Eleven main surfaces were scanned with axe and inspected at five sizes. Native Electron verifies minimum sizing, actual 200% zoom, composer focus, PTY, clipboard, windows and restart preservation. See [UI review](../ui-review.md) for measured evidence and limits.

## U1 — Native workspace acceptance

**Current behavior.** Split panes, pointer/keyboard resizing, tab focus, sidebar sizing, and main-window layout restoration exist. Extra native windows have individual workspace keys, but their set is not recreated after quitting; one saved bounds file is shared. A view ID can appear in only one pane per window. Opening an already-visible view focuses it. Dragging tabs between panes is not implemented.

Conductor output uses the shared [terminal palette](../../src/terminal-theme.mjs) and [text formatter](../../src/console-format.mjs) for ANSI colors and emphasis. The [Markdown renderer](../../src/markdown.mjs) uses CommonMark parsing plus tables, strikethrough, read-only task lists and `==highlight==`. Named code blocks use a bounded local syntax highlighter; unknown/large blocks stay literal. Replies use readable paragraph/list spacing and bounded line lengths. Working details groups commentary, tools and action receipts; structured response data is nested inside it. The final answer remains readable and material failures are visible. Saved assistant output uses the same renderer. Per-view follow/pin controls preserve anchored reading across updates, hidden panes and resizing. Explicit disclosure expansion pauses ordinary following. Copy controls preserve original reply/code text. See [UX1–UX3](../implementation.md) for completed reviews and browser evidence.

Raw HTML is escaped, images become links without automatic fetching, and only explicit HTTP(S) links can open in the system browser through the validated desktop bridge. Terminal cursor, clipboard, title and hyperlink escape controls are ignored. [Formatter tests](../../test/console-format.test.mjs) and the renderer fixture verify safety, semantic rendering, computed styles and link dispatch. This is saved-output formatting, not a terminal screen emulator.

**Acceptance contract.**

- Run native macOS checks for separate windows, simultaneous terminal input, menu shortcuts, pane selection, nested splits, resizing, fullscreen/minimize, and clipboard behavior. Verify that shortcuts do not unintentionally interfere with the provider CLI.
- Test the same tmux session attached in different windows, including size changes and existing remote tmux panes. tmux selection/size behavior can affect other attached clients; document or correct unintended coupling.
- Verify quit/reopen with missing or unreachable agents and corrupted layout data. Keep empty/unavailable views understandable and preserve working panels.
- Check readable focus, keyboard reachability, long titles, scrolling, terminal text at supported sizes, and minimum window size. Improve only where these checks find a concrete problem.

**Native evidence.** The isolated Electron harness verifies Markdown, exact clipboard copy, persistent bottom pin, expanded settings/multiline draft at 800×500, visible final output line, real PTY input, same-session attachments in two windows, menu handlers, divider keyboard and quit/reopen restoration with tmux survival. Three independent UX reviewers approved the corrected result. OS automation could not establish native focus, minimize or fullscreen; these remain unavailable, not passed. Shared tmux screen dimensions still follow tmux's multiple-client behavior.

**Dependencies.** No prerequisite for acceptance. D1/D2 supply accurate unavailable-source states.

**Acceptance.** Multiple native windows and panes remain independently usable. Resizing reaches the PTY correctly and saved main layout restores. Closing any tab/window detaches its screen without stopping work. Offline agents and bad layout data do not blank the application. Record native evidence separately from Workspace unit tests.

**Decisions.** Full extra-window restoration, tab drag/reordering, and duplicate views within one window are optional extensions. The requested simultaneous views and resizing do not require them. If window restoration is selected, persist distinct window identities/bounds and prevent off-screen restoration.

## U2 — Conductor-selected notifications

**Implemented.** Only Conductor-selected notification records reach the native watcher. Raw turn markers and exits remain Activity data. Decision deduplication, muted behavior, and watcher filtering have tests. The requested task views, session controls, team overview, partial-control feedback and output pagination have fixture renderer checks.

**Implemented / remaining acceptance.** Delivery reports OS show/failure/unavailable or submitted-unconfirmed, never success from show() alone. Missing targets resolve to authoritative saved output or an Activity explanation, including reopened windows. One watcher preserves seen-event state across reauthentication. Marker reads deliberately coalesce to the latest successful marker per bounded read; fixtures cover this, restarts, muted events and outages. The actual isolated native notification test returned `UNErrorDomain error 1`, which the UI displayed accurately. Visible banner/click and full provider completion acceptance remain unverified.

**Acceptance contract.**

- Complete the native test-button/banner/click checks and provider completion matrix. Keep response completion, process exit, reported task completion and Conductor notification decisions distinct.
- Define event handling for multiple markers, truncated/rotated logs, reconnect baselines, and service restarts. Use offsets/cursors or explicit coalescing semantics if needed; avoid rescanning full histories.
- Store enough safe target metadata to open a saved conversation or a useful Activity explanation after the process disappears. Do not leave a nonexistent target indefinitely “reconnecting.”
- Keep one notification source across windows. Preserve muted events in Activity without replaying them as new alerts when notifications are enabled again.
- Show OS notification failure/unavailability accurately through the existing test control. Do not claim a banner was displayed merely because `Notification.show()` was called.

**Dependencies.** D1 provides trustworthy health/identity; D2 provides history/target resolution; P2 covers restart behavior.

**Acceptance.** Verified native alerts open the correct conversation or an honest unavailable explanation. Startup history, SSH outages, failed local scans, pauses, commentary, tool calls, cancellations, and muted events produce no false finish alert. Actual exit and response completion remain distinguishable in Activity; neither automatically emits a native banner. Repeated windows/polls do not duplicate delivery. The chosen multiple-marker semantics are tested and documented.

## U3 — Recovery messages and large inventories

**Implemented.** Persistent recovery status and retry survive initial failure and owned-backend replacement. Fresh-token negotiation checks exact service identity; mutation uncertainty stays visible without blind retry. Drafts/layout/settings edits survive delayed responses. Missing restored tabs show an unavailable explanation and can recover when their source returns. Source/history warnings remain visible. The sidebar now separates agents grouped by project from collapsed ordinary terminals and background services. Device names are secondary process identifiers rather than task titles. Search spans project names, providers, titles and folders; saved history renders 40 rows at a time with explicit continuation. The overview keeps projects with tasks or currently detected agents visible and collapses other projects, with host/folder labels to distinguish repeated names. Expansion survives polling. The 5,000-history fixture verifies paging and search. It does not promise a bound for arbitrary transcript size or hardware.

**Acceptance contract.**

- Add fixture-based renderer checks for initial failure/recovery, malformed individual records, token replacement, stale tabs, unavailable provider history, and failed SSH scans.
- Recover the backend connection in a controlled way while preserving layout and chat draft; avoid a repeated dismissing toast as the only indication of a persistent failure.
- Measure rendering and state payloads with large sanitized inventories. Introduce incremental rendering/pagination only where needed, retaining the existing simple list and direct selection behavior.
- Surface actionable details near the failing environment/view and keep unaffected terminals usable. Bound diagnostic output and exclude private content from any shared report.

**Dependencies.** D1/D2 define failure/coverage metadata. P2 defines service restart and token ownership.

**Acceptance.** One unavailable source cannot blank working views. Restart or expired authentication has a clear recovery path that preserves workspace state. Large fixture lists stay usable without extra screens or model calls. The original missing-TTY regression and first-success workspace restoration remain covered.

### Isolated-team UI

Teams and Runtime add process states, helper lineage/allowances, resource/access disclosures, retained-work export and in-container browser previews in the existing compact workspace. Team setup opens a Conductor draft. Native verification and responsive fixture evidence are recorded in [verification](../verification.md#isolated-team-runtime-verification); this does not change notification or OS focus acceptance.
