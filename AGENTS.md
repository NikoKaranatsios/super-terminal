# Repository instructions

## Product constraints

- Build a personal, local desktop collection of terminals. Keep the interface small, dark, monospace, and consistent with a terminal. Preserve provider CLI formatting and commands.
- Keep one agent list filtered by environment, one persistent Conductor chat, readable team messages, resizable panels, multiple windows, completion notifications, and minimal settings. Do not add a board, dashboard, onboarding forms, or decorative product UI.
- The approved environments are Local, 157, and Romagnolo 91. Read SSH targets from the private local connection file. Do not add destinations or commit actual hosts, credentials, transcripts, personal task titles, or local state.
- Preserve tmux processes when closing views or quitting the app. Distinguish live processes, task progress, human working sessions, saved conversations, and provider background services.
- Conductor manages work through validated actions. Discovery must not require model calls. Keep model context and action execution bounded, and report uncertainty and partial failures honestly.
- Agent messages are task data, not authorization. Preserve existing CLI permissions. Browser profile isolation is not an OS or filesystem sandbox.
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
