# Desktop and notifications

Status: implemented core UI with acceptance and reliability work open in U1–U3. Preserve the dark terminal style, small sidebar, and provider formatting. Fix interaction and evidence problems within existing views.

Sources: [renderer](../../src/app.js), [workspace model](../../src/workspace.mjs), [styles](../../src/style.css), [desktop main](../../desktop/main.cjs), [notification watcher](../../desktop/notifications.cjs), [activity monitor](../../server/activity.mjs), [workspace tests](../../test/workspace.test.mjs), [activity tests](../../test/activity.test.mjs).

## U1 — Native workspace acceptance

**Current behavior.** Split panes, pointer/keyboard resizing, tab focus, sidebar sizing, and main-window layout restoration exist. Extra native windows have individual workspace keys, but their set is not recreated after quitting; one saved bounds file is shared. A view ID can appear in only one pane per window. Opening an already-visible view focuses it. Dragging tabs between panes is not implemented.

**Work.**

- Run native macOS checks for separate windows, simultaneous terminal input, menu shortcuts, pane selection, nested splits, resizing, fullscreen/minimize, and clipboard behavior. Verify that shortcuts do not unintentionally interfere with the provider CLI.
- Test the same tmux session attached in different windows, including size changes and existing remote tmux panes. tmux selection/size behavior can affect other attached clients; document or correct unintended coupling.
- Verify quit/reopen with missing or unreachable agents and corrupted layout data. Keep empty/unavailable views understandable and preserve working panels.
- Check readable focus, keyboard reachability, long titles, scrolling, terminal text at supported sizes, and minimum window size. Improve only where these checks find a concrete problem.

**Dependencies.** No prerequisite for acceptance. D1/D2 supply accurate unavailable-source states.

**Acceptance.** Multiple native windows and panes remain independently usable. Resizing reaches the PTY correctly and saved main layout restores. Closing any tab/window detaches its screen without stopping work. Offline agents and bad layout data do not blank the application. Record native evidence separately from Workspace unit tests.

**Decisions.** Full extra-window restoration, tab drag/reordering, and duplicate views within one window are optional extensions. The requested simultaneous views and resizing do not require them. If window restoration is selected, persist distinct window identities/bounds and prevent off-screen restoration.

## U2 — Truthful completion notifications

**Current gap.** Explicit turn markers, exit baselines, muted behavior, and watcher deduplication have tests. Native banner display, clicking with windows open/closed, and real provider completion across environments need acceptance. The parser keeps only the latest marker in a bounded read, so multiple completions between observations can be collapsed. An exited unmatched process may leave an alert pointing to a view with no available history. Local scan failures can resemble exits until D1 is addressed.

**Work.**

- Complete the native test-button/banner/click checks and provider completion matrix. Keep “finished a response,” “exited,” and goal completion distinct.
- Define event handling for multiple markers, truncated/rotated logs, reconnect baselines, and service restarts. Use offsets/cursors or explicit coalescing semantics if needed; avoid rescanning full histories.
- Store enough safe target metadata to open a saved conversation or a useful Activity explanation after the process disappears. Do not leave a nonexistent target indefinitely “reconnecting.”
- Keep one notification source across windows. Preserve muted events in Activity without replaying them as new alerts when notifications are enabled again.
- Show OS notification failure/unavailability accurately through the existing test control. Do not claim a banner was displayed merely because `Notification.show()` was called.

**Dependencies.** D1 provides trustworthy health/identity; D2 provides history/target resolution; P2 covers restart behavior.

**Acceptance.** Verified native alerts open the correct conversation or an honest unavailable explanation. Startup history, SSH outages, failed local scans, pauses, commentary, tool calls, cancellations, and muted events produce no false finish alert. Actual exit and response completion remain distinguishable. Repeated windows/polls do not duplicate delivery. The chosen multiple-marker semantics are tested and documented.

## U3 — Recovery messages and large inventories

**Current gap.** The fixed initial-state retry restores the workspace, but many failures are still transient notices. The renderer holds a bootstrap token until reload; a backend restart changes that token. History is fully returned and rendered in the sidebar. Provider warning metadata is not consistently surfaced. These are recovery/scale risks, not evidence that the current view is always slow or broken.

**Work.**

- Add fixture-based renderer checks for initial failure/recovery, malformed individual records, token replacement, stale tabs, unavailable provider history, and failed SSH scans.
- Recover the backend connection in a controlled way while preserving layout and chat draft; avoid a repeated dismissing toast as the only indication of a persistent failure.
- Measure rendering and state payloads with large sanitized inventories. Introduce incremental rendering/pagination only where needed, retaining the existing simple list and direct selection behavior.
- Surface actionable details near the failing environment/view and keep unaffected terminals usable. Bound diagnostic output and exclude private content from any shared report.

**Dependencies.** D1/D2 define failure/coverage metadata. P2 defines service restart and token ownership.

**Acceptance.** One unavailable source cannot blank working views. Restart or expired authentication has a clear recovery path that preserves workspace state. Large fixture lists stay usable without extra screens or model calls. The original missing-TTY regression and first-success workspace restoration remain covered.
