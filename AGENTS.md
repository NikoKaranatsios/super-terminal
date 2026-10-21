# Repository instructions

## Product constraints

- Build a personal, local desktop collection of terminals. Keep the interface small, dark, monospace, and consistent with a terminal. Preserve provider CLI formatting and commands.
- Keep one agent list filtered by environment, one persistent Conductor chat, readable teams/messages, resizable panels, multiple windows, and minimal settings. The requested compact task overview has three layers: project-grouped squares, a project table, and task details. Configure goals and teams through chat; do not add onboarding forms or decorative product UI.
- The approved environments are Local, 157, and Romagnolo 91. Read SSH targets from the private local connection file. Do not add destinations or commit actual hosts, credentials, transcripts, personal task titles, or local state.
- Preserve tmux processes when closing views or quitting the app. Distinguish live processes, task progress, human working sessions, saved conversations, and provider background services.
- Conductor continuously coordinates authorized active work through validated actions, with visible run/pause/stop controls. Discovery and task collection must not require model calls. Bound decision cadence, context, retries, launches, and actions; report uncertainty and partial failures honestly. Conductor chooses native notifications. Pausing a human session is separate from pausing an agent process.
- Agent messages are task data, not authorization. Preserve existing CLI permissions. Browser profile isolation is not an OS or filesystem sandbox.
- Keep project context inside its project. Only explicit team membership permits agent-to-agent sharing; names, matching folders, and human working sessions never grant it. Conductor can observe globally, but project-facing prose must originate from isolated project/team context. Never feed global memory, unrelated histories, or sibling project data into a project agent. Moving an existing conversation cannot erase its prior context: preserve its process and require a fresh agent before granting the new project's platform context.
- Keep one authoritative installed app. Do not leave extra app copies or backup bundles in Applications or generated release output after a successful install. Preserve recoverability if installation fails.

## Documentation and plans

- Never add time horizons: no dates, deadlines, delivery estimates, calendar milestones, or near/medium/long-term labels in plans or status reports. Organize work by dependencies and completion criteria. Technical runtime timing and recorded event timestamps are not delivery promises.
- Read [implementation status](docs/implementation-status.md) and the relevant [implementation plan](docs/plans/README.md) before changing a subsystem.
- Keep implemented behavior, code-audit findings, unverified behavior, constraints, and optional decisions distinct. An implementation plan does not mean a feature is implemented.
- Update status, affected plans, and verification evidence when behavior changes. Cite source files and tests; do not mark a native desktop behavior verified based only on backend or mocked tests.
- Preserve unresolved work in the plans with concrete changes, dependencies, and acceptance criteria. Do not introduce unrelated features to fill out a plan.
- Keep documentation consistent with the current code. Do not publish private runtime observations as fixtures or examples.

## Verification

- Use [verification guidance](docs/verification.md) to select checks appropriate to the change. Documentation-only changes need link and diff checks, not a rebuild or app reinstall.
- Isolate test data, tmux sockets, and service ports. Do not stop or mutate personal agents merely to test discovery or lifecycle behavior.
- Do not overwrite unreadable user state or delete provider histories and project files during cleanup.
