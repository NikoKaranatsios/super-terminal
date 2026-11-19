# Packaging, service compatibility, and recovery

Status: personal macOS installation and service reuse are implemented. P1–P3 now include tested installer failures, exact service identity/recovery and nested persisted-state validation. Source builds remain the distribution method.

The `0.11.0` source release includes the buildless public project page in [`website/`](../../website/README.md). Existing deployment scope is the authoritative Mac app, public source and static project page; configured SSH environments remain session sources. Static deployments upload only the six documented public assets into an immutable release directory, retain the previous release, atomically switch the current symlink and recreate only the dedicated static container. Verify origin asset hashes, public HTTPS/security headers, container health and absent application API before considering rollout complete; restore the prior symlink/container configuration if checks fail. Do not deploy the desktop backend as a public web service.

Sources: [packager](../../scripts/package-desktop.mjs), [installer](../../scripts/install-desktop.mjs), [backend owner](../../desktop/backend.cjs), [main process](../../desktop/main.cjs), [store](../../server/core.mjs), [service initialization](../../server/index.mjs), [desktop runtime check](../../test/desktop-runtime.cjs).

Public-page acceptance additionally covers the local demo's session/state transitions, direct example-terminal input, view-only limits, parent/worktree navigation, canvas interactions, installation-copy fallback and narrow layouts under the production CSP. The [website fixture](../../test/website.test.mjs) exercises these without provider requests. Website-only changes do not require rebuilding or replacing the desktop app.

## P1 — One-copy installation and rollback acceptance

**Current behavior/gap.** Installation stages a replacement, checks the existing bundle identity and running app, renames the replacement into place, moves the old bundle to Trash, and removes the generated app copy. A failed replacement rename restores the old app. If moving the old bundle to Trash fails, its staging directory remains to preserve recoverability. The `0.7.0` installation passed strict deep signature, 60-file/runtime identity and four-session tmux preservation checks; generated output was consumed. [Installer fixtures](../../test/installer.test.mjs) now cover missing/wrong builds, unrelated/running apps, copy, replacement, rollback, Trash and cleanup failures; failures identify the installed path and retained recovery artifacts.

**Installation contract.**

- Make filesystem/process/bundle operations testable in disposable directories without replacing the personal app.
- Cover missing build, different existing bundle identity, app running, copy failure, replacement failure, rollback failure, unavailable Trash, and failure removing generated output.
- Report the authoritative installed path and retained recovery artifacts precisely after any failure. Do not declare a clean one-copy installation while a staging copy is intentionally retained.
- Verify package contents, native PTY helper permissions, ad hoc signature, runtime dependencies, and ignored private/generated files. Decide whether engineering docs belong in the runtime bundle; this is packaging housekeeping, not a new distribution channel.

**Dependencies.** None for fixture tests. P2 validates the service started by the installed bundle.

**Acceptance.** A successful install leaves one authoritative installed app and no duplicate generated app bundle. Failures preserve a usable previous or replacement app and identify any recovery path. An unrelated app and private runtime data are never replaced or erased. No personal agent process is killed by an installer test.

**Scope boundary.** Public notarization, automatic update delivery, release hosting, Linux desktop acceptance, and Windows support are not required for this personal macOS app. The packager contains a Linux path, but that alone is not verified Linux support.

## P2 — Backend compatibility and reconnect behavior

**Implemented.** Reuse checks product, API protocol, data-directory hash and exact runtime build identity. An owned service has bounded restart attempts; a reused/unknown service is never stopped or restarted by this app. Renderers recover fresh authentication after checking health/bootstrap identity, preserve drafts/layout and show persistent recovery status. The shared watcher reauthenticates without replaying seen events. An actual isolated utility-process kill/restart verified fresh-token recovery and tmux survival.

**Implementation contract.**

- Include build/API compatibility information in health negotiation. Specify which combinations can be reused and which require a controlled restart.
- Preserve service ownership: never stop a service merely because it occupies the port or is not owned by this instance. Show a concrete recovery action while keeping tmux work alive.
- Define recovery for backend crash, stalled startup, port conflict, app reopen, and token rotation. Coordinate renderer reconnect with U3 and native watcher reauthentication.
- Test owned versus reused shutdown semantics. Keep UI/help claims consistent: quitting stops an owned backend, not a separately launched compatible service.

**Dependencies.** U3 implements renderer recovery. No changes to CLI processes are required for service compatibility checks.

**Acceptance.** An incompatible service cannot silently serve the new app. A compatible service can be reused without taking ownership or stopping it on quit. Owned-service restart reconnects views and notifications with fresh credentials while tmux survives. Unknown services on the port are left intact.

## P3 — Persisted state, migration, and diagnostics

**Implemented.** Each environment is a working directory from `directories.json`. Its markdown records live in that directory. Process identity and credentials stay in `runtime/runtime.json`. A previous `state.json` is migrated once and kept as `state.migrated.json`. Unknown future versions or malformed shapes fail without replacing the original. Failed writes identify the retained pending directory. Canonical task migration remains responsible for its own reference-preserving changes. The retention policy below distinguishes bounded technical windows from user history and correctness records. A versioned minimal remote index is persisted; diagnostics expose counts/categories without private context.

**Conflicting stores.** The source reader rejects startup when both `runtime/runtime.json` and an active `state.json` exist. Every subsequent workspace save also checks for recreated legacy state before writing. The initial migration remains supported; the retained `state.migrated.json` backup does not cause a conflict. [State regressions](../../test/state-schema.test.mjs) cover newer legacy conversations, unreadable legacy data, and legacy files appearing after a new, saved or migrated workspace was opened. They assert that existing file contents remain unchanged.

**Recovery inspection.** The [read-only inspector](../../server/workspace-recovery.mjs) and [CLI](../../scripts/inspect-workspace-recovery.mjs) compare both stores against the migration backup. They report unique and baseline-only records, same-ID differences, memory partitions, nested pending receipts and extension-field presence without exposing source values. All environment Conductor buckets are validated; directory/file observations are checked again before returning a fingerprint. [Regression tests](../../test/workspace-recovery.test.mjs) verify redaction, source preservation and concurrent-change rejection. This is an inspection result, not a lock, merge candidate or authorization.

**Offline reconciliation.** [Recovery application](../../server/workspace-reconcile.mjs) and its [CLI](../../scripts/recover-workspace.mjs) now support an explicit keep-current-project-fields policy. They retain unique records from both current stores, union historical conversations and receipts by identity, and preserve every source and baseline-only record in a byte-verified private archive. Different project names/notes/path aliases/timestamps retain the active legacy app's complete values; alternate values remain in the archive. Conflicting authority, session identities, conversations, receipts, settings and unknown top-level fields are refused. Environment memories are selected from one source, never concatenated or moved into project partitions. Recovery stops saved Conductor loops and never launches or signals agents.

The command refuses active turns and unresolved action receipts, requires app/server writers to be absent, holds the service port, and uses a recovery lock checked by workspace startup and saves. It stages and reopens all recovered records before swapping directories, preserves custom non-record files, rechecks source fingerprints/bytes before replacement, and rolls back caught partial failures. A crash, failed rollback or failed cleanup leaves the lock and archive for explicit operator review; do not remove them to force startup. Old builds cannot honor the new lock: they must stay closed throughout the operation. [Recovery tests](../../test/workspace-reconcile.test.mjs) cover the policy, source drift, active/pending blockers, writer lock, partial replacement, failed rollback and source preservation.

**Prepared installation and activation.** The [upgrade finisher](../../scripts/finish-recovery-upgrade.mjs) validates the exact source/tool/build identities and package signature, refuses an active Conductor conversation, quits the identified app, installs the guarded build while offline, applies recovery, and reopens the app. It sends only the original owner request and selected project identity through the ordinary owner chat. Structured actions still require fresh project dispatch and the existing privacy guard; direct team/agent mutation APIs are not used. Durable receipts prevent repeating a possibly submitted activation after a lost response. Role checks distinguish a running provider CLI from unverified task acceptance. [Upgrade tests](../../test/recovery-upgrade.test.mjs) cover manifest validation, one-time submission, uncertain outcomes and process reporting.

**Installation evidence.** The 0.8.0 update used the offline install and recovery commands against the personal installation. Source/package/running build identities match, the bundle signature verifies, and a private verified archive retains both source stores and alternatives. Recovery launched no agents and left Conductor loops stopped. All checked local processes and tmux pane identities survived. Team activation and new provider task acceptance remain unverified. See the [recovery procedure](../operations.md#conflicting-state-stores); personal records and prepared manifests must stay outside repository fixtures.

**Implementation contract.**

- Add an explicit state version and validators/migrations for sessions, projects/scopes, teams, messages, preferences, Conductor state, and activity. Validate before replacing persisted data.
- Preserve the original unreadable state on failure. Offer a precise diagnostic and recovery procedure; never reset to empty data automatically.
- Define bounded storage or explicit cleanup for stale technical records without discarding the user's chat, task history, profiles, or handoff notes unexpectedly. Make migrations repeat-safe and preserve references.
- Add a minimal local diagnostic summary with application/build identity, source health, and resource ownership. Redact credentials and avoid copying raw transcripts or private SSH details into repository artifacts.
- Document crash/write failure handling and any retained recovery files. Do not introduce routine duplicate app backups contrary to the one-version requirement.

**Retention policy.** User chat, tasks, project/session records, context and browser profiles are retained until an explicit operation removes them. Existing bounded technical windows remain: activity 200, messages 2,000, task events 500, and bounded traces per turn. Replay receipts, provenance and lifecycle tombstones are retained because deleting them could repeat an effect or weaken isolation. Automatic pruning of these correctness records is not introduced. `/api/diagnostics` returns version/schema, counts, resource counts and source health categories; it omits paths, targets, credentials, messages and raw errors.

**Dependencies.** C1 and T2 define data-model changes; D2 defines remote index cache format. Validate migrations together with those changes.

**Acceptance.** Old valid state migrates without loss; malformed nested state fails with a specific recoverable explanation. A failed save/migration does not overwrite the original data. Reference integrity holds across carry-forward, reassignment, and cleanup. Diagnostic output contains no agent tokens, login material, or conversation bodies by default.
