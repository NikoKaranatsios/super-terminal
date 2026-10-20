# Super Terminal

A local home for Codex, Claude, Grok, and ordinary terminals. No task board.

## Run

Requirements: macOS or Linux, Node.js 22.13+, Python 3, tmux, and whichever agent CLIs you use. Sign in through those CLIs as usual.

```sh
brew install tmux            # macOS; use your package manager on Linux
npm install
npm run build
npm start
```

Open **http://127.0.0.1:4317**. On macOS, double-click **Start Super Terminal.command** to build, start, and open the app.

The server binds exclusively to loopback. Closing the page or restarting the server leaves managed terminals running in a dedicated tmux server. Rebooting the computer ends those processes; agent conversation history remains available.

## What it does

- Real interactive terminals with xterm.js, node-pty, and tmux. Native slash commands, permission prompts, shortcuts, and existing CLI login work normally.
- A searchable sidebar grouped by workspace, provider, or host; split view for two terminals.
- Read-only discovery of local terminal processes and default tmux sessions.
- Local Codex, Claude, and Grok conversation previews and resumption. Large previews are bounded; full conversations remain accessible through the CLI.
- Explicitly configured SSH hosts, remote process discovery, remote tmux attachment, and new SSH terminals.
- Editable startup prompts, shared group notes, and persistent agent mailboxes.
- A lightweight, **on-demand** coordinator. No background model calls.
- Separate, persistent browser profiles per managed session, launched only when requested.
- Working sessions with a start briefing, a project/goal outline, progress, and a saved wrap-up.
- Teams with a shared mission, editable agent roles, and drag-and-drop membership.

## Your working session

Open **Working sessions → Start a working session**. Enter the big topics you want to tackle, one per line:

```text
Romagnolo: Finish the release flow
Romagnolo: Verify onboarding
Research: Prepare the demo
```

The app groups these into **working session → projects → goals/tasks**. Other lines go into General. This outline uses no model calls. A working session is your work period; agent terminals are separate and survive moving between working sessions.

- **Start:** optionally carry unfinished goals from a previous session and request a quick AI briefing. Only one working session is active at a time; starting another pauses the previous one.
- **Progress:** click `[ ]`, `[~]`, or `[x]` to change a goal's status, or click its title to save progress notes. Set a project's folder and local/SSH host through its location link.
- **Assign:** use **＋ Agent** at the session, project, or goal level. Launch a new agent with that scope or assign a managed terminal already running. Agents in the same working session can exchange handoffs, even across project groups.
- **Wrap up:** save a handoff note, completed work, and open goals. This makes a local summary without a model call and leaves your terminals running. **Start next session** carries only unfinished goals forward with fresh identifiers.

Scoped agents can report their own progress with the helper:

```sh
python3 /path/to/super-terminal/server/bridge.py progress --status doing --notes "Implementing the API."
python3 /path/to/super-terminal/server/bridge.py progress --goal GOAL_ID --status done --notes "Implemented and verified."
```

Goal-level agents can update only their assigned goal; project-level and session-level agents can update goals within their assigned layer. A completion report must include a note. Assigning an existing agent queues its new scope in its inbox; it does not interrupt its current prompt.

## Teams

Click **Teams ＋**, enter a mission, choose a folder and host, and optionally link the team to a working session or project. Add existing managed terminals with **Add existing agent** or drag them from the sidebar onto the team.

**Launch agents** offers editable Lead, Implementer, and Reviewer roles with Codex, Claude, or Grok selectable for each. Launching starts the selected CLIs with the mission, role, shared context, and mailbox instructions. **Brief existing agents** queues the current mission in their inboxes. A team can mix providers and existing local/remote terminals.

## SSH connections

Store approved connections outside the repository:

```sh
mkdir -p ~/.super-terminal
cp connections.example.json ~/.super-terminal/connections.json
chmod 600 ~/.super-terminal/connections.json
```

Edit that file to contain your SSH aliases or `user@hostname` targets, then restart. Only these hosts can be launched from the app. SSH uses your existing keys and known-host verification. Configure nonstandard ports and proxy jumps in `~/.ssh/config`. Servers need Python 3 for the mailbox bridge and tmux for sessions to survive a lost SSH connection. Agent CLIs must also be installed and signed in on the remote machine.

Launching a managed remote session installs a small Python helper and a private, session-scoped credential under that SSH user's `~/.super-terminal/`. A loopback-only reverse SSH tunnel lets that session use its mailbox and private browser on the local platform. It has no access to the dashboard's terminal-control API. Agent browsers run on the local computer, including for remote agents.

Discovery connects on server startup and when you click **Scan**. Remote agents belonging to a different OS user may have an unavailable working directory or inaccessible tmux session.

## Working together

Launch agents in the same **group**. The platform appends instructions for discovering peers, reading shared context, sending handoffs, and checking the inbox at meaningful milestones. Set each agent's role or conventions in **Startup prompts** (⚙), and provide its actual assignment in **Initial task**.

The built-in helper uses only Python's standard library:

```sh
python3 /path/to/super-terminal/server/bridge.py peers
python3 /path/to/super-terminal/server/bridge.py inbox
python3 /path/to/super-terminal/server/bridge.py context
python3 /path/to/super-terminal/server/bridge.py send --to SESSION_ID --message "The API is ready."
python3 /path/to/super-terminal/server/bridge.py send --to coordinator --message "Blocked on credentials."
```

`SUPER_TERMINAL_AGENT_CONFIG` is supplied automatically to managed terminals. Remote startup prompts contain the appropriate remote helper path. Inboxes mark messages read when requested. Mail does not inject keystrokes into a running agent and does not automatically wake idle agents. Agents still need to follow their startup instructions; cooperation is not an autonomous scheduler.

Shared notes and messages stay local. Clicking **Ask coordinator** sends a bounded snapshot to the selected model through the Codex CLI and its existing login. The default is GPT-6-Luna with low reasoning effort, compact replacement instructions, no user plugins or shell tools, and a read-only sandbox. It sees at most 16 terminal summaries, 8 recent conversations, 14 mailbox messages, and relevant notes; the snapshot is capped at 22,000 characters. Actual input/output token counts appear under each answer. It summarizes and proposes handoffs; it does not dispatch work. Set `SUPER_TERMINAL_COORDINATOR_MODEL` if your account needs another model.

The coordinator uses Codex's documented [`model_instructions_file` setting](https://learn.chatgpt.com/docs/config-file/config-reference) to avoid loading the full coding-agent instructions for a short status update.

## Separate browsers

Each managed session gets its own browser profile with separate cookies and storage. It never attaches to your normal browser profile or tabs. Google Chrome is detected on macOS/Linux; alternatively install Playwright Chromium with `npx playwright install chromium`, or set `SUPER_TERMINAL_BROWSER` to a compatible executable.

```sh
python3 /path/to/super-terminal/server/bridge.py browser open --url https://example.com
python3 /path/to/super-terminal/server/bridge.py browser snapshot
python3 /path/to/super-terminal/server/bridge.py browser click --selector 'role=button[name="Continue"]'
python3 /path/to/super-terminal/server/bridge.py browser fill --selector '#field' --text 'value'
python3 /path/to/super-terminal/server/bridge.py browser press --key Enter
python3 /path/to/super-terminal/server/bridge.py browser screenshot
python3 /path/to/super-terminal/server/bridge.py browser close
```

Snapshots expose accessible page text; screenshots are saved on the calling agent's machine. The dashboard's **Browser** button lets you inspect the current page. Browser profile isolation is **not** a filesystem or container sandbox. CLI agents retain their usual permissions; Super Terminal does not bypass approval prompts.

## Boundaries

- Arbitrary terminals already running elsewhere are discoverable but cannot safely be adopted. Control them in the original terminal, attach through tmux, or resume their saved conversation here.
- Existing sessions launched outside this platform do not receive its startup prompt or mailbox automatically.
- Remote process metadata and tmux sessions are discovered; remote provider conversation archives are not imported in this version.
- Closing a managed SSH terminal disconnects SSH; an existing remote tmux session may continue on the server. Reattach via **Scan**. Its mailbox tunnel must be re-established to continue using local platform tools.
- History readers support the local provider formats detected during development. They tolerate partial JSONL records and do not modify provider state.
- This app can control your shell. Keep it on loopback; do not expose it through a public proxy. It rejects unexpected Host/Origin values, requires a per-start dashboard token, and gives agent clients separate scoped credentials.

## Local data

Everything persistent is under `~/.super-terminal/`:

| Path | Contents |
| --- | --- |
| `connections.json` | Approved SSH destinations |
| `state.json` | Working sessions, projects/goals, teams, terminal metadata, prompts, messages, coordinator history |
| `agents/` | Private agent bridge credentials |
| `context/` | Shared Markdown notes |
| `browsers/` | Separate browser profiles |

These paths are outside the Git repository. Codex, Claude, and Grok keep their own authentication and conversation storage.

Optional environment variables: `PORT` (default 4317), `SUPER_TERMINAL_DATA`, `SUPER_TERMINAL_SOCKET`, `SUPER_TERMINAL_BROWSER`, `SUPER_TERMINAL_COORDINATOR_MODEL`.

## Verify

```sh
npm run build
npm test
```

Tests exercise real PTY input, resize and reconnection, shell quoting, state persistence, rejected-update atomicity, access controls, scoped messaging/progress, concurrent team launch, session wrap-up/carry-forward, browser cookie isolation, and launch/cancellation cleanup. Coordinator lifecycle tests use fake executables and never make model calls. Integration tests use temporary storage and a separate tmux server. They do not contact configured SSH servers or make model requests.
