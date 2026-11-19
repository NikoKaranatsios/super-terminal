# Engineering documentation

This documents current behavior and the remaining implementation and acceptance work. The audit is based on repository code and existing verification evidence. It is not a claim that every provider, SSH account, or native desktop path has been exercised.

| Document | Purpose |
| --- | --- |
| [Execution document](implementation.md) | Ordered work, review findings and completion evidence |
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
