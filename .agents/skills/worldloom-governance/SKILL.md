---
name: worldloom-governance
description: Use when changing WorldLoom compile, review, merge, rollback, or version logic in the standalone product repository.
---

# WorldLoom governance changes

Inspect the affected `src/lib/worldbuilding`, `src/lib/governance`, API, Prisma and test paths before editing. Preserve the product invariants in `docs/HANDOFF.md`: model output enters `Change`, merge is serialized per world in a transaction, and `WorldVersion` is append-only.

For a change to the compile or merge chain, test the success path together with partial failure/recovery, duplicate changes, concurrent edits, provenance and rollback as applicable. If the schema changes, include a migration and verify deployment on a clean database. Report which checks actually ran and which deployment or provider evidence remains external.

This skill is specific to WorldLoom. It does not authorize importing surrounding workbench files or changing other project repositories.
