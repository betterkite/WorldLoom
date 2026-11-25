# WorldLoom product guidance

- This directory is the independent WorldLoom product repository. Its Git history and GitHub remote do not include the surrounding workbench.
- Read `docs/HANDOFF.md` for product invariants; use `docs/PROJECT_REVIEW.md` for module ownership and `docs/DEPLOYMENT_SECURITY.md` for release boundaries when relevant.
- Keep LLM output behind `Change` review and keep `WorldVersion` append-only.
- Verify changed modules with focused tests, then run relevant typecheck, lint, build, browser and deployment checks before claiming release readiness.
- Do not commit workbench metadata, other projects' skills or knowledge, local credentials, or generated runtime artifacts into this repository.
