# WorldLoom client boundary marker

This is WorldLoom's own implementation of the two conditional-export behaviors:
the default entry performs no work; the `react-server` entry rejects the import.
It is not a copy of, or a license notice for, the npm `client-only@0.0.1` release.
The compatible package name and distinct local version let existing callers
keep importing `client-only`; this private package is not published to npm.

The product's pnpm override selects this directory for the external marker used
by styled-jsx. Next.js's internal compiler aliases remain unchanged, including
its build-time Server Component checks. See the official
[environment-boundary documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).

Keep the package and its MIT license in source distributions and runtime
tracing. This replacement does not resolve notices for code vendored inside
Next.js or other dependencies; those remain separately inventoried.
