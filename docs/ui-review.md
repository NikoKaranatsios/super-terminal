# UI review

Super Terminal `0.7.2` keeps the compact terminal style while making conversations and work context easier to find and use.

## Isolated-team source extension

The working tree extends Teams with runtime readiness, explicit access/resource limits, helper lineage, pending/error receipts and member controls. Runtime details show saved source, parent/children, native terminal access, patch export and actual in-container browser previews. Configuration stays in Conductor; runtime links are visible directly in terminal context. Button busy states and partial errors remain local to the affected runtime. Named Runtime tabs distinguish multiple agents.

The [runtime fixture](../test/runtime-ui.test.mjs) checks draft retention, navigation, graph links, paused controls and layouts down to 320 CSS pixels. Axe-core 4.14.0 found no tested A/AA issues on Teams and Runtime. The [native runtime harness](../scripts/test-sandbox-native.mjs) exercised actual Electron/Docker terminal input, Chromium preview, pause/resume, patch saving, minimum-size zoom and quit/reopen survival. Its file picker result is controlled so writes stay in the disposable fixture; real OS file-picker interaction is not claimed. Native and fixture screenshots were visually inspected. See [full evidence](verification.md#isolated-team-runtime-verification).

These additions are not installed in the personal app; its separate state-recovery dependency remains. The earlier installed-release evidence below applies to that release only.

## Changes

| Surface | Result |
| --- | --- |
| Window header | Working-session selector, status and controls moved out of the sidebar. Human work-session state stays separate from agent process state. |
| Sidebar | Project-grouped agents, readable role names, deduplicated metadata, separate stopped agents, visible disconnected/unknown agents and correct count labels. Shells/services/history remain distinct. |
| Overview | Search by project, folder and environment name; explicit environment and working-session filters; detected-agent counts; quiet projects remain collapsed until searched. |
| Project/task | Search and state filters; readable table widths; bounded note previews; full notes and evidence in details; keyboard-accessible horizontal table scrolling. |
| Teams | Search, project links, mission, members and direct conversation entry. Explicit team identity determines membership. |
| Team conversations | Team/text filters, Markdown bodies, linked sender/recipient identities, timestamps and delivery states. Choose one available recipient; send uses the existing validated mailbox endpoint. |
| Agent conversations | Project/task/session context in the header; process/assignment controls in a compact disclosure; accurate service/unavailable labels; noninteractive services have no message composer. |
| Typing | Opening/selecting a chat or clicking its message area focuses the composer. Explicit terminal clicks preserve native CLI input. Keyboard tab navigation keeps focus on tabs until activated. |
| Drafts/settings | Agent/team/prompt drafts persist on this device. Failed saves retain drafts or restore the previous preference. New drafts typed during an in-flight send are preserved. |
| Keyboard/narrow layouts | Arrow/Home/End tab navigation, Delete to close, adjacent-tab focus, valid tab/panel relationships, stronger focus indicators and a focus-contained navigation drawer. |
| Docs/activity | Updated guide and existing readable status, notification and activity surfaces reviewed at wide, minimum and zoomed sizes. |

## Verification

- **221 source tests pass**, including the added UI regressions; no provider model calls were used for UI verification.
- **Three staged renderer tests pass** against the release baseline plus frontend changes.
- **55 layout captures** cover eleven main screens at five sizes: 1280×850, 800×500, 640×425, 400×250 and 320×568 CSS pixels. Representative images were visually inspected.
- **Axe-core 4.14.0:** zero tested A/AA findings across eleven wide layouts. The baseline exposed invalid tablist children and insufficient shortcut contrast; both were corrected.
- **Native Electron:** minimum sizing, actual 200% zoom, navigation, composer focus, clipboard, live terminal input, multiple windows, keyboard controls, draft/layout restoration and process survival pass in isolated state.

Tests: [UI review](../test/ui-review.test.mjs), [synthetic fixture](../test/fixtures/ui-review.mjs), [work UI](../test/work-ui.test.mjs), [native harness](../scripts/test-native-ui.mjs), [workspace](../test/workspace.test.mjs). Implementation: [app](../src/app.js), [work views](../src/work-views.mjs), [sidebar](../src/sidebar-model.mjs), [styles](../src/style.css).

## Installation

The authoritative installed app is `0.7.2`. Runtime files, exact build identity and strict signature verification match the reviewed release. All eight pre-install tmux sessions survived; no task records or provider histories were removed. Native inspection confirms the new header/sidebar and team-conversation composer focus.

## Limits

Automated checks and fixture screenshots are not full accessibility certification or a VoiceOver acceptance pass. Wide task tables and terminal grids retain their essential two-dimensional layout. Native notifications remain blocked by OS permission in this environment; the UI reports that failure. Native minimize was not confirmed. Queueing a message proves storage for an agent checkpoint, not provider acceptance or task completion. Source tests include separate unfinished MCP/enrollment work; the installed UI release excludes that backend work.

Keyboard behavior follows the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and [keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/). Responsive review uses the [WCAG reflow guidance](https://www.w3.org/WAI/WCAG21/Understanding/reflow), including its exception for essential two-dimensional content.
