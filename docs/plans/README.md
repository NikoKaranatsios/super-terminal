# Implementation plans

These plans cover unfinished requested behavior, concrete audit findings, and outstanding acceptance checks. They do not authorize unrelated UI, destinations, background agents, or public distribution. Status definitions are in the [documentation index](../README.md).

| Plan | Items | Dependencies |
| --- | --- | --- |
| [Discovery and history](discovery-and-history.md) | D1 healthy inventories/identity; D2 history coverage/recovery; D3 provider compatibility | D2 matching uses D1 identity; D3 fixtures inform both. |
| [Conductor and working sessions](conductor-and-sessions.md) | C1 project/scope/action parity; C2 session lifecycle/evidence; C3 bounded context/action accounting | C2 uses C1 and T3; C3 consumes D2 evidence quality. |
| [Teams and agent lifecycle](teams-and-agent-lifecycle.md) | T1 reliable startup; T2 membership/mailbox/bridge recovery; T3 stop/cleanup semantics | T1 uses D3; T2 uses C1; T3 must define ownership before destructive cleanup. |
| [Desktop and notifications](desktop-and-notifications.md) | U1 native workspace acceptance; U2 truthful notification delivery; U3 resilient errors and large inventories | U2 uses D1/D2 health and identity; U3 consumes their status metadata. |
| [Browsers and runtime isolation](browsers-and-runtime.md) | B1 browser lifecycle/concurrency; B2 isolation boundary | B1 shares cleanup with T3; B2 has a product decision for stronger isolation. |
| [Packaging and recovery](packaging-and-recovery.md) | P1 installer failure checks; P2 backend compatibility/restart; P3 persisted-state validation | P3 migrations must accommodate C1/T2 data changes. |

## Completion rule

An item is complete only when the named behavior is implemented, relevant automated checks pass, required desktop/provider/SSH acceptance is recorded, and limitations are reflected in [implementation status](../implementation-status.md). A source audit alone does not complete a verification item. Keep unrelated user work and data intact during checks.

## Decisions that are not required feature work

- Recreating every extra native window after quitting, tab drag/reordering, and duplicating one view across panes in the same window: [U1](desktop-and-notifications.md).
- Enrolling an already-running non-tmux process for platform tools, or adding custom tmux socket discovery: [T2](teams-and-agent-lifecycle.md), [D1](discovery-and-history.md). Do not imply live TTY takeover.
- OS/container isolation beyond separate browser profiles: [B2](browsers-and-runtime.md).
- Public signing/notarization, automatic updates, Linux acceptance, or Windows support: [P1](packaging-and-recovery.md). Personal macOS use remains the target.

Resolve a decision only if the user need warrants the extra behavior. Otherwise retain the documented constraint. There are no calendar milestones, estimates, or time horizons.
