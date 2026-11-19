// Static public help. Runtime projects, paths, messages and credentials belong
// in private application state, never in this bundled guide.
export const helpSections = [
  {id:'overview',title:'Getting around',markdown:`# Super Terminal

Super Terminal brings your agent terminals, work records and Conductor into one compact workspace.

## The sidebar

The **Graph** home groups detected agents by project across configured environments. Click an agent once to open its terminal beside the graph and type directly there. Compact nodes show provider, model, task, branch, work state and question/activity previews; a project node connects each group. **Details** opens the full evidence and access information in an inspector. **Sessions** offers an alternative list. **Running** describes a process, not task completion. Unknown or disconnected processes remain labelled **Unverified**. Models come from provider metadata or saved output; an unavailable identity is shown as **Model unknown**.

Use **More** for Conductor, projects, teams, saved conversations, settings and human working-session controls. These controls record work without pausing agent processes.

- **Navigation** opens the sidebar in a narrow or zoomed window.
- **Graph** returns to the main view (⌘1). Search projects, models, branches or tasks. Click a project to focus it and choose **All projects** to return. Use the **Agents / All terminals** switch to include ordinary shells. Drag empty canvas space or scroll to pan. Drag a node to save its position on this device; dragging never opens or launches a session. Use the minimap to jump around, **Fit** to see the whole graph, **100%** to reset zoom, and **Tidy up** to restore automatic positions for visible nodes. Hold ⌘/Ctrl while scrolling to zoom around the pointer. Arrow keys move between nodes; Enter opens one. Focus the canvas and press F to fit.
- **Sessions** (⌘2) returns to the live list. Search by project, model, provider, terminal or location. **New terminal** chooses the provider, environment and directory.
- **Conductor** is the persistent chat for executing work and coordinating teams and agents.
- **System graph** shows Conductor, agents, tasks, teams, MCP and background services in the selected environment. Its status appears in **More**. Select a node to inspect work, messages and delivery, then open its conversation or terminal directly.
- **All projects** opens task squares grouped by project. Projects without recorded tasks or currently detected agents are under **Other projects**. Search and environment filters narrow the overview. Folder paths distinguish repeated project names. Project tables also have task search and state filters; full notes remain in task details. Select a project for its task table, or a square for the task’s context and evidence.
- **Teams** shows missions, members, runtime limits and helper relationships. Check runtime availability there, then describe an isolated team and its helper allowance in Conductor. **Runtime & browser** opens its terminal controls, saved-source details, patch export and private browser preview.
- **Environment** filters the graph and session list. **All environments** keeps local and remote sessions visible together, even when you open a remote terminal. Shells are available through **All terminals** and the Sessions list; background services and stopped sessions are under **More**. Saved history shows 40 entries at a time. Management views use the last selected concrete environment, named in their headers.
- **Saved conversations** contains saved provider output. It is separate from live terminals.

## Activity and subagents

**Needs input** comes from an explicit unanswered provider input request. **Question in reply** means a question was detected at the end of the last reply; waiting is not confirmed. **Blocked** comes from a recorded task report. **Working** comes from provider events or task reports, separately from the process state. **Just finished** means a turn or reported task finished recently; it does not prove the whole project is complete. Older completed turns show **Idle**. Missing, old or disconnected activity stays **Unknown** or **Unverified**. Node colors and text show activity; questions and blockers have an amber preview. **Details** shows the full question or activity, evidence source, observation age, exact time, task reports and next steps. Escape closes the inspector. The filters at the top let you jump straight to agents needing attention.

Projects, agents and subagents connect from left to right. Solid connections indicate project membership; dashed connections indicate subagents. Working connections animate unless reduced motion is enabled. The inspector shows the actual directory and a reported-task progress bar when available; it counts recorded tasks and does not estimate completion. Large inventories start at a readable zoom and can be explored through search, project focus, panning, Fit and the minimap. Parent links come from managed helper relationships, Codex thread metadata or Claude subagent files. Older saved children fold under their parent; use its subagent button to expand them. Active work, unanswered questions and recent completions remain visible, and search or activity filters reveal matching children with their parents. A saved subagent is view only and does not claim a separate live process. Providers may omit relationships, approval prompts or output; the graph cannot reconstruct unavailable evidence. Grouping worktrees changes the overview, not an agent’s project permissions or team membership.

## Your workspace

Open multiple tabs, split panels and resize the sidebar. Selecting an already open view focuses it. Opening a terminal or selecting its tab focuses native terminal input immediately. Session views have no additional input bar. Conductor and team conversations retain their own message boxes. Use arrow keys, Home and End in the tab bar, and Delete to close the selected tab. Closing a view detaches that view; it does not stop the underlying agent. Quitting the app preserves tmux processes and isolated containers.

Background coordination requires the app’s local service. Quitting the desktop app stops that service and Conductor; keeping tmux alive does not keep coordination running.

Open **Controls** in the agent header and use **Stop process** when you intend to stop it. The result can be partial or unavailable, especially when an environment is offline.`},
  {id:'conductor',title:'Conductor and skills',markdown:`# Conductor

Start typing immediately. A working session is optional; it records your work and does not unlock file access.

The chat header shows the current context separately from the settings owner, model, reasoning, file access and skills. Expand it to choose a model, reasoning effort, **Full access**, **Workspace write** or **Read only**, and whether installed skills are enabled. Choose a working session under **More** to edit that session’s settings, then select **Save**. Changes apply to the next message; a running reply keeps its original settings. Empty model and reasoning fields use your CLI defaults. Each new reply records its model and access.

Use the skill picker to insert an installed skill, or mention it with $name. The list comes from the local Codex CLI and the selected project. Connected skills and integrations depend on that CLI’s installed configuration and sign-in.

Direct chat can run commands and edit files within the chosen access setting. Commands run locally, using the selected local project as their working directory. Remote work uses the configured SSH connections. File access is separate from project context sharing and team membership.

Replies and saved assistant output support Markdown, tables and code blocks. **Working details** keeps tool activity available without burying the answer. Copy a reply or code block with its **Copy** button. Failed or partial steps remain visible. Conductor reconstructs bounded same-scope conversation context for each request; older omitted exchanges or an excerpted latest exchange are disclosed.

Output follows the newest text by default. Scroll up to read earlier output; **New output** or **Jump to latest** returns to the bottom. **Pin to bottom** keeps the newest output visible even when output grows. Each pane keeps its own position. Opening working details pauses normal following so their beginning stays visible.

The background loop keeps using validated platform actions. Its direct shell, file-editing tools and skills remain disabled; a manual access change does not expand automatic authority.`},
  {id:'system-graph',title:'System graph',markdown:`# Inspect the whole system

Open **System graph** in the sidebar or from Conductor. It works without a chat composer. It shows the selected environment's observed processes and work alongside the local control service, collection, discovery, MCP bridge, terminal connections, browser contexts and notifications.

Select an agent to see its process state, assigned tasks and reports, initial launch prompt when captured, latest saved output and messages. **Open conversation / terminal** takes you directly into the existing agent view. External processes may only expose saved output; selecting a node does not take over a terminal or grant process control.

Select Conductor for its current request, visible tool activity, action receipts and background controls. A started action is pending, a queued message has not been acknowledged, and a running process does not prove task progress. Failed and partial actions remain inspectable. Only provider-visible events are available; private model reasoning and unlogged output cannot be shown.

Drag empty canvas space or scroll to pan. Use **Fit**, **+**, **−** and **100%** to zoom. Search, type and project filters narrow the graph; clear them to restore the overview. Projects without observed work have an explicit show button. Large graphs disclose hidden nodes and offer **Show more**. Keyboard users can Tab through nodes and use Enter to inspect them.

The graph refreshes with the inventory, normally every five seconds. It preserves selection, zoom, open details and reading position. A disconnected service keeps the previous snapshot with an offline label. Source warnings and bounded message, action and activity windows remain visible; open the source conversations for more output.

## Coordinate from a terminal conversation

An agent with the **super_terminal** MCP server can use **st_context**, **st_graph**, **st_conductor**, **st_tasks**, **st_report**, **st_send**, **st_inbox** and **st_ack** in its normal conversation. Send to **coordinator** to reach Conductor. Progress, messages and tool contact appear in the graph. Existing external agents require explicit enrollment; the app does not silently inject tools into them.

This covers work inside the agent's authorized assignment. Messages queue task data and do not start an owner chat, resume a paused loop, or grant authority to launch unrelated agents. Owner controls and decisions remain available in Conductor. MCP contact is an observed request, not proof that its stdio process remains connected.

New managed provider launches retain the exact application-supplied prompt. Older and external agents may have no recorded launch prompt. A current mission is labelled separately; it is not substituted for the original prompt. Saved output identifies the first recorded user message only when its first page is available.`},
  {id:'isolated-teams',title:'Isolated teams',markdown:`# Linux runtimes and helpers

Start Docker in the selected environment. Open **Teams**, check availability and prepare the runtime image. Describe the project, roles and helper allowance in Conductor. Configuration opens a draft; it is never submitted silently.

An isolated agent starts from committed HEAD in its own checkout and home. Your uncommitted host work stays in place. Sign into the provider inside that runtime's terminal. The standard image includes Codex and Claude; other providers require a compatible image. The runtime uses a private team network with exact allowed destinations or offline mode.

**Runtime & browser** shows the source commit, agent state, parent/helpers and launch limits. Open its terminal, pause/resume or stop it, and inspect a preview such as http://localhost:3000 in its own Linux browser. This localhost belongs to the agent container.

**Export changes** briefly pauses a running runtime and creates a patch from its saved work, then resumes it. Review the patch before applying it to your project. Stopping retains its private workspace, provider home and browser profile; source export remains available. Stopped provider conversations cannot yet be reopened from this view.

Only the owner can enable helpers or change the grant. Managed helpers inherit the team and project; active-agent, total-launch and depth limits apply, including failed launches. Pending or uncertain requests retain their identity instead of launching duplicates. Provider-internal workers and billing are separate from these platform limits.

Containers share the Docker host kernel. They have no host home, repository mount or Docker socket. Host-mode agents keep their existing permissions. Linux browser acceptance does not verify macOS desktop behavior.`},
  {id:'projects',title:'Projects and focus',markdown:`# Projects and current context

Conductor is one conversation across all projects and environments. The project, task or agent you focus is shown above the chat so references such as “this task” are clear. Focus does not restrict Conductor’s conversation, memory or access to other projects.

Project matching uses available project and directory evidence. An unknown or ambiguous project stays visible as unresolved; a folder name alone is not proof that two agents belong to the same project.

## Move an agent to a project

Open **Controls** in the agent header, choose a project and select **Move**. This changes the work assignment and tracking context. It does not change the running process’s directory, move project files or restart the CLI.

A running agent cannot forget its previous model context when it moves. If a move requires isolation, its platform mailbox and context are withheld until you start a fresh agent in the new project. The existing terminal remains available. A history continuation would retain old context, so use **Start fresh in project** for this boundary.

Choose **Unassigned** to deliberately leave the agent without a project. This is a manual choice, not a claim that detection found no project.

An agent’s project assignment determines its own project context. An explicitly shared team enables context sharing with its members; matching a name or folder does not enroll an agent. Leaving or changing an existing team can also require a fresh agent because previous model context cannot be erased.

Conductor coordinates project work from this global conversation. Agent-facing instructions are generated internally using the destination project’s context; global conversation content is not forwarded to agents. Cross-project agent collaboration requires an explicitly shared team. You do not need to switch Conductor into a project.

Create a project or working session directly in chat. Creation uses your current request in a clean context; a single created project becomes the next focus unless you already selected another. Your conversation remains global. Goals and teams are configured in Conductor chat. For example: “Review the example project, split the work into tasks, and assign a reviewer.” Browsing a saved working session does not resume it or reassign its agents.`},
  {id:'messages',title:'Message an agent',markdown:`# Message an agent

Type directly in an interactive terminal. The provider handles Enter, slash commands, approvals and keyboard shortcuts. Session views do not have a separate message composer. To queue a cooperative mailbox message instead, use **More → Team messages** or Conductor. Their unsent drafts remain on this device.

**Team conversations** has a team filter, message search and a recipient selector. Choose a specific member to queue a message to that agent. This does not broadcast to the team. Sender and recipient names open their agent views. Delivery labels distinguish queued, read and acknowledged handoffs.

| Transport | What happens | What the status proves |
| --- | --- | --- |
| Managed mailbox | Your message is queued for the agent’s next helper checkpoint. | Queued means stored. Read means fetched, not accepted or completed. Acknowledged means the agent explicitly acknowledged the message, not that work finished. |
| Live terminal | Your text and Enter are sent to the attached terminal. | Input was submitted to the terminal; the CLI’s output shows what happened next. |
| External terminal | Read matched saved output here; type in the original terminal. | A non-tmux process cannot safely be adopted for input. Start future sessions here for direct access. |
| Saved conversation | Explicitly continue the available history in a managed agent. | A continuation creates or resumes a managed session; it does not take over the original external terminal. |

## Native CLI input stays available

Select a live terminal to use the provider’s normal commands, approvals and formatting. A mailbox message does not answer a CLI permission prompt. Check the terminal’s current prompt before sending direct input.

Pausing a process delays its next checkpoint. Messages withdrawn after reassignment are labelled **Withdrawn**; they are no longer waiting for delivery. Failed or unavailable transport leaves your draft in the composer. For a lost managed SSH connection, use **Reconnect remote** to reconnect the existing remote terminal and helper. A shared background service is not an interactive agent.`},
  {id:'background',title:'Background work',markdown:`# What runs in the background

The live status above this guide reports the state the interface received. It distinguishes collection from model decisions.

## Collection and discovery

The app refreshes visible state and discovers supported local terminals, tmux sessions and configured SSH environments. It reads supported provider history and structured task reports. These collection steps do not themselves require a Conductor model call.

Source failures are shown as unavailable or stale. A failed SSH connection does not prove an agent stopped. Project context may be updated from available evidence; ambiguous results remain unresolved.

## Continuous Conductor

When its loop is running, Conductor can make paced, event-driven model decisions for authorized active work. It receives bounded context, acts through validated controls, and records action results. New observations and errors affect its next decision. Unchanged work does not trigger paid model polling.

This coordination runs only while the local app service is alive. Quitting the app stops its service and Conductor even though tmux processes can continue.

**Pause background** and **Stop background** stop automatic coordination. **Stop reply** cancels the current reply. Completed actions are retained; cancellation does not undo them. Agent processes and human working-session controls remain separate.

## Notifications

Conductor chooses which updates deserve a desktop notification. Activity also records response completions and process exits. A completed response, an exited process and a finished task mean different things. Native banners additionally depend on the app setting and operating-system permission. The notification test reports whether macOS confirmed display, rejected it, or left it unconfirmed. Missing targets open saved output or an Activity explanation.`},
  {id:'progress',title:'Sessions and task state',markdown:`# Sessions and task progress

A **working session** is your human work record. An **agent session** is a running or saved CLI session. A **provider conversation** is saved output. These are separate records.

Pausing or stopping a working session leaves its agents running independently. Use the explicitly labelled process controls to pause, resume or stop an agent. Remote or partial failures remain visible.

## Task squares

| Square | Meaning |
| --- | --- |
| Green › | In progress |
| Yellow ! | Problem or blocker |
| Dark blue ✓ | Finished |
| Gray ■ | Stopped |
| Hollow ○ | Not started |

Each square represents one task; it is not a calendar activity count. The project table and task details read the same task records. Completion evidence records who reported it. It does not mean the platform independently reran a test.

Describe new goals, changes and handoffs in Conductor. Wrapping work preserves unfinished items and their context.`},
  {id:'output',title:'Output and privacy',markdown:`# Output, limits and local state

Live terminals preserve the provider CLI’s formatting and input. Saved conversations expose the messages, commentary and tool traffic available in supported provider logs. Load earlier output to move backward through large histories.

Unlogged output and provider-internal hidden reasoning are unavailable. Large or incomplete records can be omitted with a coverage note. An external process may have uncertain or absent history; a same-folder conversation is only a candidate until matched.

## Where information goes

Runtime sessions, tasks, messages and project context are kept in the app’s private local state. SSH connections use the locally configured environments. Conductor model calls send their bounded context to the configured provider; project text and agent messages in that context are still data, not permission to expand the task.

Host-mode browser profiles separate browser state from personal tabs; they do not sandbox the shell or filesystem. Explicit isolated teams add private Linux runtimes with the access and resource boundaries described in **Isolated teams**. Native provider approval behavior is preserved.

The bundled guide and test examples are fictional. Never add real conversation content, private project models, host details or access keys to source fixtures.`}
];
