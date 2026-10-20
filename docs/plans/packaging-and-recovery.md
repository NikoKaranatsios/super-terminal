# Packaging, service compatibility, and recovery

Status: personal macOS installation and service reuse are implemented. P1–P3 cover failure paths and persisted-state gaps. Source builds remain the distribution method.

Sources: [packager](../../scripts/package-desktop.mjs), [installer](../../scripts/install-desktop.mjs), [backend owner](../../desktop/backend.cjs), [main process](../../desktop/main.cjs), [store](../../server/core.mjs), [service initialization](../../server/index.mjs), [desktop runtime check](../../test/desktop-runtime.cjs).

## P1 — One-copy installation and rollback acceptance

**Current behavior/gap.** Installation stages a replacement, checks the existing bundle identity and running app, renames the replacement into place, moves the old bundle to Trash, and removes the generated app copy. A failed replacement rename restores the old app. If moving the old bundle to Trash fails, its staging directory remains to preserve recoverability. The successful installation path has been exercised; failure branches lack automated fixture coverage.

**Work.**

- Make filesystem/process/bundle operations testable in disposable directories without replacing the personal app.
- Cover missing build, different existing bundle identity, app running, copy failure, replacement failure, rollback failure, unavailable Trash, and failure removing generated output.
- Report the authoritative installed path and retained recovery artifacts precisely after any failure. Do not declare a clean one-copy installation while a staging copy is intentionally retained.
- Verify package contents, native PTY helper permissions, ad hoc signature, runtime dependencies, and ignored private/generated files. Decide whether engineering docs belong in the runtime bundle; this is packaging housekeeping, not a new distribution channel.

**Dependencies.** None for fixture tests. P2 validates the service started by the installed bundle.

**Acceptance.** A successful install leaves one authoritative installed app and no duplicate generated app bundle. Failures preserve a usable previous or replacement app and identify any recovery path. An unrelated app and private runtime data are never replaced or erased. No personal agent process is killed by an installer test.

**Scope boundary.** Public notarization, automatic update delivery, release hosting, Linux desktop acceptance, and Windows support are not required for this personal macOS app. The packager contains a Linux path, but that alone is not verified Linux support.

## P2 — Backend compatibility and reconnect behavior

**Current gap.** Health probing validates product, protocol, and a data-directory hash. It does not identify the source build or API capabilities. Reusing an older compatible-looking service can run different code than the installed app. Reused services are not owned/stopped by that app instance. An unexpected owned service exit offers app restart; renderers retain their old token until reload.

**Implementation.**

- Include build/API compatibility information in health negotiation. Specify which combinations can be reused and which require a controlled restart.
- Preserve service ownership: never stop a service merely because it occupies the port or is not owned by this instance. Show a concrete recovery action while keeping tmux work alive.
- Define recovery for backend crash, stalled startup, port conflict, app reopen, and token rotation. Coordinate renderer reconnect with U3 and native watcher reauthentication.
- Test owned versus reused shutdown semantics. Keep UI/help claims consistent: quitting stops an owned backend, not a separately launched compatible service.

**Dependencies.** U3 implements renderer recovery. No changes to CLI processes are required for service compatibility checks.

**Acceptance.** An incompatible service cannot silently serve the new app. A compatible service can be reused without taking ownership or stopping it on quit. Owned-service restart reconnects views and notifications with fresh credentials while tmux survives. Unknown services on the port are left intact.

## P3 — Persisted state, migration, and diagnostics

**Current gap.** `state.json` uses temporary-file replacement and fails visibly on malformed JSON, but validates only sessions/hosts arrays. Other nested structures use defaults without schema migration. Messages/activity are capped; Conductor turns, assessments, lifecycle records, and other metadata have no common retention policy. Logs and state can contain private paths/work context. Cached remote history is not durable yet.

**Implementation.**

- Add an explicit state version and validators/migrations for sessions, projects/scopes, teams, messages, preferences, Conductor state, and activity. Validate before replacing persisted data.
- Preserve the original unreadable state on failure. Offer a precise diagnostic and recovery procedure; never reset to empty data automatically.
- Define bounded storage or explicit cleanup for stale technical records without discarding the user's chat, task history, profiles, or handoff notes unexpectedly. Make migrations repeat-safe and preserve references.
- Add a minimal local diagnostic summary with application/build identity, source health, and resource ownership. Redact credentials and avoid copying raw transcripts or private SSH details into repository artifacts.
- Document crash/write failure handling and any retained recovery files. Do not introduce routine duplicate app backups contrary to the one-version requirement.

**Dependencies.** C1 and T2 define data-model changes; D2 defines remote index cache format. Validate migrations together with those changes.

**Acceptance.** Old valid state migrates without loss; malformed nested state fails with a specific recoverable explanation. A failed save/migration does not overwrite the original data. Reference integrity holds across carry-forward, reassignment, and cleanup. Diagnostic output contains no agent tokens, login material, or conversation bodies by default.
