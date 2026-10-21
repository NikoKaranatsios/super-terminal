// Static public help. Runtime projects, paths, messages and credentials belong
// in private application state, never in this bundled guide.
export const helpSections = [
  {id:'overview',title:'Getting around',markdown:`# Super Terminal

Super Terminal brings your agent terminals, work records and Conductor into one compact workspace.

## The sidebar

- **Working session** records what you are working on. Browse saved sessions without restarting them.
- **Conductor** is the persistent chat for organizing work, teams and agents.
- **All projects** opens task squares grouped by project. Select a project for its task table, or a square for the task’s context and evidence.
- **Teams** shows missions and members. Select the intended project or task, then describe the team in Conductor.
- **Agent environment** filters the terminal list. It does not hide other environments from All projects.
- **Conversations** contains saved provider output. It is separate from live terminals.

## Your workspace

Open multiple tabs, split panels and resize the sidebar. Selecting an already open view focuses it. Closing a view detaches that view; it does not stop the underlying agent. Quitting the app preserves tmux processes.

Background coordination requires the app’s local service. Quitting the desktop app stops that service and Conductor; keeping tmux alive does not keep coordination running.

Use the agent’s **Stop process** control when you intend to stop it. The result can be partial or unavailable, especially when an environment is offline.`},
  {id:'projects',title:'Projects and focus',markdown:`# Projects and current context

The current context follows the project, task or agent you focus. Conductor shows the context it will use above the chat. You can discuss a specific task or project from its own view.

Project matching uses available project and directory evidence. An unknown or ambiguous project stays visible as unresolved; a folder name alone is not proof that two agents belong to the same project.

## Move an agent to a project

Choose a project in the agent view and select **Move**. This changes the work assignment and tracking context. It does not change the running process’s directory, move project files or restart the CLI.

A running agent cannot forget its previous model context when it moves. If a move requires isolation, its platform mailbox and context are withheld until you start a fresh agent in the new project. The existing terminal remains available. A history continuation would retain old context, so use **Start fresh in project** for this boundary.

Choose **Unassigned** to deliberately leave the agent without a project. This is a manual choice, not a claim that detection found no project.

An agent’s project assignment determines its own project context. An explicitly shared team enables context sharing with its members; matching a name or folder does not enroll an agent. Leaving or changing an existing team can also require a fresh agent because previous model context cannot be erased.

Conductor can consider work across projects, but the global overview cannot generate agent-facing prompts or goals. Select a project or task for those actions. Cross-project collaboration requires an explicitly shared team. Conductor’s current focus is separate from the context provided to an agent.

Goals and teams are configured in Conductor chat. For example: “Review the example project, split the work into tasks, and assign a reviewer.” Browsing a saved working session does not resume it or reassign its agents.`},
  {id:'messages',title:'Message an agent',markdown:`# Message an agent

Every agent view has a text area. Its button and explanation identify the available transport.

| Transport | What happens | What the status proves |
| --- | --- | --- |
| Managed mailbox | Your message is queued for the agent’s next helper checkpoint. | Queued means stored. Read means fetched, not accepted or completed. |
| Live terminal | Your text and Enter are sent to the attached terminal. | Input was submitted to the terminal; the CLI’s output shows what happened next. |
| External terminal | Copy the text, then paste it into the original terminal. | Copying does not deliver a message to the agent. |
| Saved conversation | Explicitly continue the available history in a managed agent. | A continuation creates or resumes a managed session; it does not take over the original external terminal. |

## Native CLI input stays available

Click directly in a live terminal to use the provider’s normal commands, approvals and formatting. A mailbox message does not answer a CLI permission prompt. Check the terminal’s current prompt before sending direct input.

Pausing a process delays its next checkpoint. Messages withdrawn after reassignment are labelled **Withdrawn**; they are no longer waiting for delivery. Failed or unavailable transport leaves your draft in the composer. A shared background service is not an interactive agent.`},
  {id:'background',title:'Background work',markdown:`# What runs in the background

The live status above this guide reports the state the interface received. It distinguishes collection from model decisions.

## Collection and discovery

The app refreshes visible state and discovers supported local terminals, tmux sessions and configured SSH environments. It reads supported provider history and structured task reports. These collection steps do not themselves require a Conductor model call.

Source failures are shown as unavailable or stale. A failed SSH connection does not prove an agent stopped. Project context may be updated from available evidence; ambiguous results remain unresolved.

## Continuous Conductor

When its loop is running, Conductor can make paced, event-driven model decisions for authorized active work. It receives bounded context, acts through validated controls, and records action results. New observations and errors affect its next decision. Unchanged work does not trigger paid model polling.

This coordination runs only while the local app service is alive. Quitting the app stops its service and Conductor even though tmux processes can continue.

**Pause** and **Stop loop** stop automatic coordination. **Stop reply** cancels the current reply. Completed actions are retained; cancellation does not undo them. Agent processes and human working-session controls remain separate.

## Notifications

Conductor chooses which updates deserve a desktop notification. Activity also records response completions and process exits. A completed response, an exited process and a finished task mean different things. Native banners additionally depend on the app setting and operating-system permission.`},
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

Per-agent browser profiles separate browser state from your personal tabs. They do not form an operating-system or filesystem sandbox. Agents retain their normal CLI permissions.

The bundled guide and test examples are fictional. Never add real conversation content, private project models, host details or access keys to source fixtures.`}
];
