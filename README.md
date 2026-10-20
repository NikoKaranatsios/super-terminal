# Super Terminal

A local desktop collection of your terminals, with one Conductor chat. No board or dashboard.

[Implementation status](docs/implementation-status.md) · [Remaining implementation plans](docs/plans/README.md) · [Architecture and operations](docs/README.md) · [Verification](docs/verification.md)

Choose **Local**, **157**, or **Romagnolo 91** from the environment selector. The list refreshes automatically, including Codex, Claude, and Grok processes started outside the app. Click a terminal to use its original CLI; click an external agent to read its matched saved conversation. Provider background services are labelled separately from individual agents.

## Conductor

Conductor remembers your conversation and can ask about priorities and uncertain progress. It reads provider histories, caches assessments, and separates unfinished work from completed, uncertain, stale, and unreviewed conversations. The conversation list includes unreviewed history instead of pretending it has all been assessed.

Ask it naturally, for example:

- “What did I leave unfinished?”
- “Start Claude in this project and ask it to review the tests.”
- “Create a team with a Codex implementer and a Claude reviewer for this task.”
- “Pause the agent working on the import, then resume it.”
- “Stop that terminal and clean up stopped sessions.”
- “Create a project for this existing folder and assign the agent to it.”
- “Start a working session with these topics.”
- “Wrap up this session and carry unfinished goals into the next one.”

Actions run through a small validated platform API. Conductor sees the actual result before replying and reports partial failures. It can start/resume agents, start teams, queue agent messages, manage project records and assignments, start/pause/wrap human working sessions, update goals, pause/resume/stop processes, search history, and clean up stopped terminal entries. Cleanup preserves provider conversations and project files. Conductor does not have an arbitrary shell or authority to delete project files.

**Team messages** shows the agents’ mailbox conversations, including sender, recipient, team, and delivery state. New agents receive peer/mailbox instructions and the team mission automatically. Messages are queued, not injected as keystrokes; agents check their inbox at milestones. External agents can be tracked and assigned but do not gain a mailbox or startup instructions retroactively.

Conductor uses the installed Codex CLI login with GPT-6-Luna, low reasoning, compact instructions, no plugins or shell tools. The first briefing is automatic by default; subsequent model calls happen only when you ask. Each review reads a bounded batch of recent conversation excerpts, rotating across locations. Assessments and chat memory persist locally. “Review more history” continues with the next batch. History indexing and process refreshes themselves use no model calls.

## Desktop app

```sh
brew install tmux
npm install
npm run install:desktop
open "$HOME/Applications/Super Terminal.app"
```

The installed app bundles its own Electron/Node runtime and starts its loopback service automatically. Open it through Finder, Spotlight, or the Dock. No separate browser or server terminal is needed.

| Shortcut | Action |
| --- | --- |
| ⌘N | New window |
| ⌘T | New terminal tab in the selected environment |
| ⌘D / ⇧⌘D | Split right / below |
| ⌘] | Focus next panel |
| ⌘W / ⇧⌘W | Close tab / window |
| ⌘1 | Conductor |
| ⌘2 | Environment selector |
| ⌘3 | Activity |
| ⌘, | Settings |

**File → New Agent** starts Codex, Claude, or Grok with default instructions in the selected location. Settings contains text size, completion notifications, the automatic first briefing, and agent startup prompts. The app uses a minimal dark terminal appearance: charcoal surfaces, monospace text, flat tabs, and a restrained green accent. Native macOS window chrome follows the dark theme. Each agent CLI retains its own formatting.

Use **Split Right** or **Split Below** to display up to six panels per window. Click a panel and select an agent from the sidebar. Drag the sidebar or panel dividers to resize; double-click a panel divider to return to equal sizes. Focused dividers also respond to arrow keys. Tab selection and split proportions survive a reload and restore in the main window when reopening. **New Window** in the toolbar opens the selected conversation in a separate desktop window. Closing a tab detaches the screen without stopping its agent.

Completion notifications are on by default. Alerts target their conversation when available; **Activity** retains the latest 200 events across all locations. Explicit successful end-of-turn log records trigger “finished a response”; disappearing agent processes trigger a separate “exited” alert. This does not certify that a project or task is complete. Old history and SSH outages do not trigger alerts. Detection uses periodic process/history scans, makes no AI calls, and continues with windows closed while the app runs. Providers without readable completion records can only be detected when the process exits. macOS notification permissions and Focus control banners and sound; Settings includes a test button. Native banner/click acceptance and unavailable-target handling remain in the [notification plan](docs/plans/desktop-and-notifications.md).

Closing the window keeps the app running on macOS. Quitting stops an app-owned local service, its browser tools and active Conductor request; a separately started compatible service reused by the app is left running. tmux terminals survive service shutdown and can reconnect when the app reopens. Rebooting ends processes but preserves conversation histories and app data.

Runtime requirements: macOS Ventura or later, tmux, Python 3, and the agent CLIs you use, with their existing sign-ins. Building requires Node 22.13+ and npm. The macOS bundle is ad hoc signed for personal use, not notarized for public distribution.

## Discovery and SSH

Only destinations in `~/.super-terminal/connections.json` are enabled. The personal installation contains the two requested servers. Hostnames and credentials are not committed. `connections.example.json` shows the format for a fresh installation. SSH uses existing keys and normal host-key verification; ports and jumps belong in `~/.ssh/config`.

Local processes, remote processes, and history indexes refresh independently. Failed SSH scans remove stale processes from the live list while retaining in-memory history metadata; that remote cache does not survive a service restart. Zombie processes are excluded. Process existence does not mean an agent is currently doing work. Discovery is limited to visible processes, supported history formats, and the tmux sockets the readers inspect; see [coverage and remaining work](docs/plans/discovery-and-history.md).

Remote discovery is read-only. If the SSH account already permits passwordless sudo, the reader uses that existing permission to inspect root-owned provider histories and histories belonging to discovered agent accounts. It never enables sudo, requests passwords, or changes permissions. Without that access it reads what the SSH account can access. Root-owned tmux panes can be attached using the same existing sudo permission. Resumed conversations retain their original server user.

Provider history readers support Codex SQLite/JSONL, Claude project JSONL, and Grok session summaries/JSONL. They read bounded text excerpts, omit tool output, tolerate partial writes, and never modify provider history. Codex indexing includes up to 2,000 unarchived threads per account.

External conversations are linked using a resume ID, an open transcript file, or a unique provider/folder/start-time match (labelled in the view). Ambiguous same-folder conversations are offered as candidates, not asserted to belong to a process. A shared Codex runtime may have several open conversations. An inaccessible or unlogged conversation cannot be reconstructed.

Ordinary terminal processes started outside the app cannot have their live screen/input safely adopted. Their saved conversations remain readable, and individual processes can be paused/stopped where OS permissions permit. Existing tmux sessions can be attached directly. Shared provider services cannot be stopped through Conductor because they may host unrelated agents. Process control is not a container sandbox; detached child services may have their own lifetimes.

## Agent communication and browsers

Managed agents receive a private Python helper and session-scoped credential. Same-group agents or agents in the same human working session can exchange messages and progress. Remote agents connect through a loopback-only reverse SSH tunnel. Their credentials cannot control arbitrary terminals or call Conductor’s management API.

The helper exposes `peers`, `inbox`, `send`, `context`, `progress`, and `browser` commands. Startup instructions include the full command path. Each agent browser owns its own persistent profile, cookies, and storage, separate from your personal browser tabs. Browser instances start on demand. This isolates browser state, not the filesystem; CLI permissions and approval mechanisms remain in effect.

## Local data and development

Persistent data lives under `~/.super-terminal/`: approved connections, terminal metadata, Conductor chat/memory/assessments, project and working-session records, team mail, startup prompts, private bridge credentials, and isolated browser profiles. Provider CLIs keep their own sign-ins and source histories. Nothing in that folder is uploaded to GitHub. Conductor requests send bounded work context through your existing Codex account.

The renderer is sandboxed with no Node integration or arbitrary navigation. The service binds only to loopback, validates Host/Origin, and requires a fresh per-start token. Keep it off public proxies.

```sh
npm run dev              # desktop development
npm test                 # isolated backend tests; no model calls or SSH scans
npm run test:desktop     # bundled Node/native PTY/persistence check
npm run package:desktop  # build into release/
```

`npm run build && npm run start:web` exposes the same local interface for development. Optional environment variables: `PORT` (4317), `SUPER_TERMINAL_DATA`, `SUPER_TERMINAL_SOCKET`, and `SUPER_TERMINAL_BROWSER`.
