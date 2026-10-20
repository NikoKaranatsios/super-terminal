# Engineering documentation

This documents the implementation at source baseline `6726db5` (package `0.4.1`) and the work still needed. The audit is based on repository code and existing verification evidence. It is not a claim that every provider, SSH account, or native desktop path has been exercised.

| Document | Purpose |
| --- | --- |
| [Implementation status](implementation-status.md) | Requirements, current behavior, gaps, and resolved error |
| [Architecture](architecture.md) | Processes, data, APIs, and trust boundaries |
| [Implementation plans](plans/README.md) | Remaining changes with dependencies and acceptance criteria |
| [Verification](verification.md) | Existing evidence, automated coverage, and outstanding checks |
| [Operations](operations.md) | Installation, local data, recovery, and diagnostics |
| [Repository instructions](../AGENTS.md) | Durable product and documentation constraints |

## Reading status

- **Implemented:** a code path exists. Verification scope is stated separately.
- **Partial:** part of the requested behavior exists; a plan names the missing part.
- **Audit finding:** a limitation or inconsistency is visible in source. A regression scenario must establish its effect before a fix is treated as verified.
- **Unverified:** an end-to-end check is still required; this is not an assertion that the feature is broken.
- **Constraint:** behavior the platform cannot honestly promise under its present execution model.
- **Decision:** an optional extension or unresolved policy, not a commitment to add a feature.

The plans use stable item IDs. Dependencies indicate what must be established for a change; they are not a delivery schedule. No plan includes a time horizon.

## Maintaining the record

For a behavioral change, update its status row and plan item, record which acceptance checks passed, and retain any unresolved limitations. Reference a source revision and the relevant test or manual scenario. Redact private hosts, paths, credentials, and conversation content. A passing test for one provider must not stand in for the other providers.

Documentation-only updates do not change the shipped application version or require an installation.
