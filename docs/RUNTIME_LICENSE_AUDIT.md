# Runtime license payload audit

Issue: [#11](https://github.com/betterkite/WorldLoom/issues/11). This is a reproducible engineering inventory,
not a legal opinion or a release approval. Image inspections were read-only against local Linux/arm64
and Linux/x64 OCI images on 2026-09-24 and 2026-09-27. Package counts describe files in the image, not every
dependency bundled into JavaScript or native binaries.

The standalone restoration step also preserves the original `versions.json` for each traced
`@img/sharp-libvips-*` package. Next's trace can omit that file while retaining the native library.
Before writing any files, restoration checks the declaration's shape, exact package metadata and
every traced non-notice file against the same-version source installation. Conflicting declarations,
changed binaries or unsafe paths fail the step. The report records declaration and traced-file hashes;
it does not infer component versions or treat this upstream list as complete native license coverage.
The runtime auditor continues to require the declaration and does not silently skip missing evidence.

Next vendored restoration also descends into scoped package directories such as
`dist/compiled/@hapi/accept`. A namespace containing only package directories is reported by child,
not counted as a single package. For every traced component, matching source notices in nested
payload directories are retained at their original relative paths. The report binds each notice
path and hash to the exact parent installation and verified payload bytes. Untraced source siblings
are not copied, and a conflicting nested notice or symlink fails before any planned writes.
These component groups are inventory units, not proof of every bundled dependency or license grant;
missing upstream notices remain unresolved rather than being replaced with Next's own license.

| Local image | Distinct package name/version pairs | Without adjacent LICENSE, LICENCE, COPYING or NOTICE file |
| --- | ---: | ---: |
| `worldloom-license-issue7:verify` (app/worker runtime candidate) | 19 | 17 |
| `worldloom-worker` (pre-upgrade running worker image) | 19 | 17 |
| `worldloom-license-issue11:verify` (standalone license-restoration candidate) | 19 | 5 |
| `worldloom-license-issue11:amd64` (Linux/x64 CPU-only candidate) | 19 | 5 |
| `worldloom-release-candidate:checkout` (2026-09-27 integrated Linux/arm64 candidate) | 19 | 2 |
| `worldloom-release-candidate:amd64` (2026-09-27 integrated Linux/x64 candidate) | 19 | 2 |
| `worldloom-app:latest` (2026-09-27 local loopback Compose app) | 19 | 2 |
| `worldloom-v01-notices:arm64` (2026-09-30 local development candidate) | 19 | 1 |
| `worldloom-v01-notices:amd64` (2026-09-30 local development candidate) | 19 | 1 |
| `worldloom-migrate-issue7:verify` | 385 | 22 |
| `worldloom-migrate-issue11:verify` (dedicated Prisma-only migration candidate) | 35 | 0 |
| `worldloom-v01-migrate:arm64` (2026-09-30 pinned-toolchain candidate) | 35 | 0 |

The first shallow inspection found 9 top-level app packages and 48 top-level migration packages. It missed
`node_modules/.pnpm`, including `@img/sharp-libvips-linux-arm64` and other native/runtime dependencies.
The new `scripts/runtime-license-audit.mjs` scans both locations and deduplicates top-level links by
package name and version. It records package-declared licenses, relative locations and adjacent notice
files, plus native binaries under `/app`. `--strict` exits nonzero when any package has no adjacent
notice or license metadata, or a native binary cannot be assigned to a scanned package; it
currently **fails** on the app/worker candidate by design and passes on the dedicated #11 migration
candidate.

The #11 build step copies exact-version, unmodified notice files from the pnpm install into every
traced standalone package location. An earlier rebuild restored 12 package families (12 physical files),
leaving five without adjacent notices. The integrated 2026-09-27 candidate additionally stages SHA-256
and version-pinned upstream MIT texts for `@next/env@16.3.5`, `onnxruntime-common@1.30.0` and
`onnxruntime-node@1.30.0` into their exact runtime package locations. Two gaps remain:
`@img/sharp-libvips-linux-arm64@1.3.3` and `client-only@0.0.1`.
The former's available packaging-script license is not a substitute for the native library's
third-party redistribution review; no authoritative version-linked text has yet been verified for
the latter. Later on 2026-09-27, the loopback-only local Compose app and worker were replaced
with rebuilt checkout images after a database dump and rollback image tags were preserved. The
migration image and schema were not changed. This is a local development-service update, not a
commercial release; the running app still fails the strict release gate on the same two gaps.
The npm registry records `client-only@0.0.1` as MIT but supplies no repository field; the
installed tarball contains no license file. React's server-module RFC describes the marker package,
not a version-linked license grant. Exact registry integrity and source links are recorded in
`third_party/runtime-licenses/README.md`; no unverified text was staged into the image.

The first candidate contained 20 native binary files under `/app`: Sharp/libvips, ONNX Runtime and a
Prisma query engine. The Prisma engine sits in a `.prisma/client` directory outside an npm package
directory and is therefore reported as *unattributed* until its origin is explicitly mapped.
The original ONNX copy also shipped macOS, Windows and Linux/x64 binaries in the Linux/arm64 image.
The revised build retains only `linux/arm64` ONNX binaries for this target; `onnxruntime-node`
loads successfully from the resulting image. Its native-file count fell from 20 to 5 and the app
OCI image size from 206,288,092 to 115,523,303 bytes. On 2026-09-27, the integrated candidate
matched the generated Prisma Client engine byte-for-byte to the installed `@prisma/engines@6.19.3`
engine (SHA-256 `3de76598179b95c6910e28547ee3af9236d978cd3e0917b63a3b531f84bfb8d0`),
copied the exact Apache-2.0 license (SHA-256
`c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`) and shipped a
manifest that the runtime auditor verifies. Its strict inventory reports zero unattributed native
files and zero packages missing license metadata; it still exits nonzero for the two notice gaps.
The scanner does not cover binaries in the distroless base image
or dependencies bundled into JavaScript.

The `scripts/base-image-copyright-audit.mjs` verifier now inventories Debian packages and exact
version/architecture/source metadata from either distroless `status.d` or standard dpkg `status`,
then hashes each corresponding `/usr/share/doc/<package>/copyright` file. Local app runtime images
on arm64 and x64 each reported 14 installed packages and zero missing copyright files; the local
dedicated migration image reported 81 and zero missing. The first migration inspection failed
because a trailing empty status paragraph was parsed as a package; the parser was corrected and
regression-tested before the successful rerun. CI now runs strict OS copyright checks for both
images and uploads the inventories, but CI has not run on this unpublished candidate. This is a
file-coverage check, not a legal review or a reconciliation of native subcomponents and browser
bundles with the complete image SBOM.

For Linux/x64, the ONNX npm postinstall otherwise attempts an optional GPU download from NuGet;
the dependency stage now sets the package's
[documented `ONNXRUNTIME_NODE_INSTALL=skip` mode](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/node/script/install.js)
so only tarball-bundled CPU binaries enter the production build. This narrows both supply-chain and
license review scope without changing the CPU inference API.

The Linux/x64 candidate built successfully with that setting and contains only two ONNX CPU files
under `bin/napi-v6/linux/x64`; its ONNX binding loads successfully. The complete x64 image has
19 packages, 5 missing adjacent notices, 5 native files and one unattributed Prisma engine, matching
the arm64 release-gate shape **at that earlier stage**. Its OCI size is 123,190,407 bytes. The
2026-09-27 integrated x64 rebuild passed production compilation, loaded the ONNX native binding
with only `libonnxruntime.so.1` and `onnxruntime_binding.node` under the x64 ONNX directory, and
mapped the generated Prisma `libquery_engine-debian-openssl-3.0.x.so.node` to the exact source
binary (SHA-256 `a2924eab1c78a0a7bb67edac5738939fa10589ef073af5542f53812a22e4a7d8`).
Its strict inventory has 19 packages, zero missing license metadata, zero unattributed native
files and two missing notices: the x64 Sharp/libvips package and `client-only@0.0.1`. Strict audit
therefore still exits nonzero. The first integrated x64 build was rejected because the Prisma
staging script only accepted the arm64 filename; the rule was restricted to the two observed
Linux engine names, a regression test was added, and the rebuild succeeded.

Four exact-tag upstream notice/permission files and their verified SHA-256 hashes are retained in
[`third_party/runtime-licenses/README.md`](../third_party/runtime-licenses/README.md). The Next.js
and ONNX license texts are staged in the 2026-09-27 candidate; the Sharp/libvips files remain
review inputs only. ONNX native third-party obligations still need a qualified review before release.

Example, using a local image rather than the live database:

```sh
docker run --rm --network none --read-only \
  --volume "$PWD/scripts/runtime-license-audit.mjs:/tmp/runtime-license-audit.mjs:ro" \
  --entrypoint /nodejs/bin/node worldloom-release-candidate:checkout \
  /tmp/runtime-license-audit.mjs /app --strict
```

The Linux/arm64 dependency-install stage resolves 251 production package entries in
`pnpm licenses list --prod --json`; 14 of those installed package entries have no adjacent notice
file. The former migration image contains the full install, including development packages, so its
inventory is larger than the production dependency list. `webgl-constants@1.1.1` in that image also
lacks package-declared SPDX metadata. The #11 migration candidate uses a separate lockfile with
only Prisma CLI 6.19.3, not application/frontend packages. Its `prisma --version` and offline
`prisma validate` checks passed. All 15 project migrations also applied successfully to an
isolated, disposable `pgvector/pgvector:pg16` database; the temporary database and network were
removed afterward, without touching the running WorldLoom database. The 35 packages have adjacent
notices and license metadata. It has two detected native binaries, both within the Prisma engine
package. Its OCI image size fell from
458,845,714 to 123,838,665 bytes. A database-backed migration drill is still required before
each release, using that release's database/schema configuration. Do not mistake package metadata
or a license-family summary for the full notice text.

The same dedicated migration image was also built for Linux/x64; its strict inventory again found
35 packages, 0 missing notices, 0 missing license metadata and 2 attributed native binaries, and
its schema validation passed.

The CI container job applies strict runtime-package and Debian base-copyright verifiers to both
the migration and app/worker images.
The app/worker check is currently expected to fail on the two known notice gaps, so the candidate
cannot pass CI or be promoted as a commercial release.
Both image inventories are uploaded as review evidence, including on failure. CI has not yet
run on this unpublished branch.

The local integrated build combines #7 project/upstream-UI notices with this runtime audit. The
app image was rebuilt and audited locally; the dedicated migration image was audited separately.
CI and both-image release verification have not run on a published commit.

Next release-gate work:

The later 2026-09-30 candidates now stage the complete version/hash-pinned ONNX third-party
notice (338,088 bytes) and Sharp/libvips's exact v1.3.3 component notice. Both Linux architectures
built with pinned `pnpm@11.22.0`; an earlier build selected pnpm 12.8.1 via Corepack, exposing
toolchain drift, so the root/migration manifests and CI were aligned. CI also includes the six new
command-palette journeys rather than omitting them from its explicit E2E list.

Read-only, network-disabled audits of the two app candidates each report 19 packages,
**one missing adjacent notice (`client-only@0.0.1`)**, zero missing license metadata and zero
unattributed native files. Both strict commands still exit 1. The auditor now retains 40 notice
SHA-256 records, hashes all five native files, and records the hash and 28 component versions
declared in each libvips `versions.json`. Declarations are not proof of all linked code; Sharp's
component notice does not contain every underlying license text. Native/bundle/base reconciliation
and applicable distribution review remain open, so this is not license approval.

Candidate image identities (`docker image inspect .Id`):

- arm64 app: `sha256:a65a0678a1ea4876a5ca9e27d5b6fcc60e7addf050e4f86e6800b9ef0eb3efbc`
- amd64 app: `sha256:15aa6b6044752185be6c18e40aa7a239ac577d7a872452d781aeaf05876546e9`
- arm64 migration: `sha256:1555f1a671aa0df9ab55ff1cabf083313fdc95c4336d372ce4b1d878567596fa`

The migration candidate passes strict runtime inventory: 35 packages, no missing notices or
metadata, two attributed native files. Its 15 migrations applied to an owned disposable database.
Debian copyright file coverage passes again: 14 packages on each app architecture and 81 in the
migration image, none missing. The arm64 app ran read-only/non-root against that disposable DB:
live/ready 200 with version `0.1.0-dev.0`, healthy, Chromium and Edge 16/16 each, API/page audit
53/53. Fixtures were removed, the probe container and database deleted, and the existing user's
five worlds remained unchanged. These model-free checks do not rerun the paid creative chain.
The persistent 4310 service was not replaced; it remains the 2026-09-27 image with two notice gaps.
The local candidates predate final source/checkpoint updates and are not clean-commit release artifacts.

On 2026-09-30, the host production dependency SBOM contained 349 component entries, including
optional platform dependencies. All 19 npm name/version pairs in the locally running app image
matched that inventory. Its UUID URN, scoped npm Package URLs and tooling component field were
corrected, then the complete CycloneDX 1.5 schema and referenced SPDX/JSF schemas passed with
fixed source URLs and SHA-256 hashes. CI now generates release SBOMs only from clean source,
checks the actual checkout revision and archives a schema-validation report. Local candidates
record `dirty` plus a content snapshot digest; the release evidence verifier rejects them.
This does not reconcile client bundles or native subcomponents, replace notice texts, or remove
the two strict image-audit failures. The development/CI validator's additional license family
was checked and recorded in `THIRD_PARTY_NOTICES.md`.

Later on the same day, removing kbar/react-virtual reduced the host production inventory to 343
entries; the full pinned schema passed again. A read-only, network-disabled one-off inspection of
the actual running image still found 19 packages, two missing notices, zero missing metadata and
zero unattributed native files; all 19 npm version pairs matched the updated inventory. This is the
old image, not a build of the new command-palette/provider changes. No new OCI release evidence is
implied by the 241 passing tests or Chromium/Edge browser checks.

1. Preserve reviewed, version-matched license and NOTICE texts for every redistributed package and
   native component in app, worker and migration artifacts. Resolve packages whose npm tarballs omit
   these files from authoritative upstream sources; record source commit/tag and content digest.
2. Reconcile the production lockfile inventory with server-side packages, client bundles, ONNX/native
   libraries, Sharp/libvips and base-image notices. The package-directory scanner alone cannot prove
   that bundled code and binaries are covered.
3. Resolve the strict app/worker CI gate failures and extend the verifier to reject unreviewed
   versions or licenses; a zero-missing-notice count alone does not prove that bundled code, native
   components, or base-image obligations are covered. Keep the #7 project/upstream UI notice gate separate.
4. Have a qualified reviewer assess any remaining distribution obligations, particularly for the
   LGPL-licensed libvips component, before recording release approval.

Primary license sources checked for the exact versions currently inspected:

- [ONNX Runtime v1.30.0](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE)
- [Next.js v16.3.5](https://github.com/vercel/next.js/blob/v16.3.5/license.md)
- [React v19.2.4](https://github.com/react/react/blob/v19.2.4/LICENSE)
- [Sharp v0.35.4](https://github.com/lovell/sharp/blob/v0.35.4/LICENSE)


## Local client boundary marker (2026-11-07)

The source candidate replaces the external `client-only@0.0.1` dependency with
WorldLoom's independently implemented `packages/client-only` (`0.0.1-worldloom.1`).
The default entry is a no-op; the `react-server` condition rejects the import.
Its MIT text applies to this local implementation only, not to the upstream npm
release or Next.js vendored code. The pnpm override and frozen lock select the
local directory; the Docker dependency stage includes that directory before installation.
All unrelated lockfile versions/integrities are preserved.

Focused checks cover CommonJS/ESM imports, the server condition, installed
styled-jsx rendering, and SBOM metadata handling. pnpm reports a local dependency's
`version` as `file:packages/client-only`; the SBOM therefore reads the installed
package's actual name/version and preserves the locator as a provenance property.
Missing or mismatched local metadata fails generation instead of inventing a version.

The local package installed offline and includes its license; the full frozen-lock
metadata/policy check passed. These are not a full application install/build or
final image audit. Previously retained images still contain the old marker.
The next normal build must confirm tracing, restore the local license, and rerun
strict runtime/source-lock-SBOM checks. Vendored Next.js, native components, browser
bundles and base-image reconciliation remain separate release work.


## Next direct-component notice bundle (2026-11-07)

`third_party/runtime-licenses/next-vendored` now retains twelve original release texts with registry integrity and source-to-payload bindings. The production Docker payload copies the full bundle into `/app/third_party/next-vendored` and runs `verify-next-vendored-notices.mjs`; version or byte drift rejects that step. This supplies original direct-component attribution even where Next's own npm compiled directory omitted it. It does not relabel the restoration scanner's “no notice in exact-version vendored source” report as full bundle closure. See the bundle README and manifest for the exact scope and unresolved transitive groups.

The runtime also retains the complete Sharp component notice directory at
`/app/third_party/runtime-licenses/sharp-components`, matching the link in
`THIRD_PARTY_NOTICES.md`. It includes the source archive and file hashes, patch
provenance, and the original notice texts. These accompany the version-checked
copies beside the native package; the index documents attribution boundaries
and does not certify complete corresponding source or relinking obligations.

Local RepoSteward configuration and Finder metadata are excluded from the Docker
context. Payload assembly also removes the two root files from retained older
standalone output, and the image verifier rejects either filename anywhere in
the payload without reading it. The final runtime must copy the cleaned tree
onto the pinned runtime base: deleting files in a layer on top of an old runtime
image would leave the original bytes in the distributed parent layer.

The Next notice bundle also preserves five exact-release package manifests and
four original READMEs for the previously unresolved helper/fontkit/Unistore
groups. They explicitly declare MIT and retain the upstream attribution; absence
of a standalone LICENSE file is recorded separately. Unistore's named copyright
and designated dynamic-license provider are now linked to the provider's source
and an unchanged template from its declared dependency range. This is additional
source evidence, not a recovered historical rendered response or an override of
the Brotli file-level Apache declarations. See `licenseDeclarationEvidence` in
the bundle manifest for hashes, bindings and remaining scope.

The newer local standalone candidates have passed the top-level strict inventory (23 packages, zero missing notices or metadata) after the local marker fix. That supersedes the old marker gap for these candidates only; previously running images and broader distribution obligations retain their separate status.


The fontkit supplement adds nine original dependency notices, selected using Next 16.3.5’s exact upstream lock and checked against the compiled fontkit bytes. Four original grant texts remain unresolved; manifest `fontkitProvenance` records their names and exact versions. Supplemental notice verification is distinct from complete transitive attribution or final OCI acceptance.


The brotli 1.3.3 source audit additionally found seven Google Apache-2.0 decoder headers despite the package-level MIT metadata. The bundled notice now preserves all seven headers and the ASF license text, with exact source/header hashes and runtime binding. This closes that identified text omission; the package-level wrapper grant and complete transitive/OCI audit remain open.


## Runtime package and source SBOM correlation

### Notices for dependencies embedded in browser output

`scripts/stage-production-notices.mjs` consumes the installed production graph from
`pnpm list --prod --depth Infinity --json`. The Docker build runs it after compilation,
stages outside `/app` so generated material cannot affect Next tracing, and copies the
verified bundle to `/app/third_party/production-dependencies` in the runtime payload.
It conservatively retains original package declarations and recursively found license,
copyright, notice, author and patent files. With no such files, it retains available root
READMEs and records the narrower evidence class. It never fabricates an upstream grant.

Required dependencies missing from disk, inconsistent package identities, conflicting
same-version originals, selected symlinks and escaping paths reject generation. Missing
optional branches must trace back to an installed parent's `optionalDependencies`
declaration. The manifest binds the source lockfile and graph, records skipped branches
separately, and checks exact file digests and the complete distributed file set. The Docker
payload rechecks it after copying. The focused tests include failures for dropped root
dependencies, required omissions, tampering, traversal and inconsistent peer contexts.

This closes the *collection path* for installed production dependencies that may be bundled
into browser output; it is not a module-to-chunk map or a full license conclusion. Package
manifests and README declarations are distinguished from complete upstream notice texts.
Native/Rust subcomponents, vendored dependencies absent from the npm graph, and applicable
source/relinking obligations still require their specific evidence. Counts of source-graph
components include optional platform branches; do not call every such component installed.

### Runtime directory correlation

The CI evidence job compares each npm name/version in the production runtime
inventory with the source dependency SBOM. Runtime inventory is collected by
running the immutable image ID, recorded in that inventory, and matched against
the inspected image ID. Missing packages, different versions, duplicate or empty
inventories, and image identity mismatches fail correlation. The evidence index
retains the inventory SHA-256 and matched package URLs. Invocations without a
runtime inventory report this check as PENDING.

Source-only packages are allowed: the source production graph also includes
browser dependencies that are not standalone npm directories. This check does
not enumerate embedded JavaScript, static browser bundles, native subcomponents
or base-image software; their separate provenance and notice checks remain
necessary. It is not a claim that the source dependency SBOM is a complete OCI
SBOM. The migration image uses its own lockfile and remains a separate inventory.

The same evidence verifier checks the SBOM lockfile digest against the checkout
and compares a verified signed SBOM predicate with the complete supplied SBOM
JSON. Signature verification itself remains the upstream `gh attestation verify`
step; synthetic correlation tests do not establish cryptographic validity.

## Standalone tracing and final payload assembly

The standalone output is an intermediate build artifact. Route tracing excludes
repository source/test/documentation directories, dotenv files and local caches.
Next instrumentation traces may still retain ONNX pnpm copies. After Docker
copies the locked architecture-selected ONNX package and its common package,
`deduplicate-onnx-runtime.mjs` validates every retained file against those copies
and checks package versions before replacing duplicate physical packages with
relative links. Only files belonging to other native platforms may be discarded
without a counterpart in the selected payload. A mismatch aborts before replacing
any package. This keeps Transformers' pnpm dependency resolution attached to the
same selected ONNX runtime.

The image payload verifier rejects repository-only root directories as well as
dotenv/key files. Run it against the image before attaching runtime model-cache
volumes: the local `.cache` volume is provisioned at runtime and is deliberately
not distributed in the image. Compiled application files, dependencies, config,
Prisma assets, public fonts and all staged license texts remain part of assembly.


The fontkit notice bundle additionally preserves the upstream project LICENSE merged
on 2026-11-02 (commit `d65a577ea30bfce9ce84dc8045860b2abbc1968b`).
It is explicitly marked as a later project-level source, not an original file in
the 2.0.2 release. The manifest binds the unchanged notice and traced payload
bytes while retaining the historical-release and inherited-notice applicability
question. This source recovery does not change the runtime dependency or close
the complete fontkit distribution review.


## Node outside the Debian package inventory

The pinned app and build/migration bases install Node separately from dpkg. CI
therefore adds `--node-runtime` to both base-image audits: it checks the running
Node release against a reviewed version and verifies the complete upstream
LICENSE, including Node's bundled notices. Missing/truncated/changed notices,
unreviewed versions or executable locations, and paths escaping the image root
fail the check. The source copy and provenance are in
`third_party/runtime-licenses/README.md`; the base images already carry the same
bytes. No duplicate app-level copy or application behavior change is required.

Local read-only checks of the pinned Linux/arm64 bases found Node 24.21.0 and
matching original notices, plus 14 (distroless) and 79 (Node Debian) installed
Debian package copyright files with none missing. The latter is the base before
WorldLoom installs OpenSSL/CA packages, not the final migration image. Final
app/worker/migration OCI inventories and other native obligations remain separate.


The versioned notice stage now checks the reviewed embedded libvips/cgif/
libimagequant/mozjpeg versions before including their five original notice files.
The complete IJG acknowledgement is also retained in product documentation. This
is a partial native-component notice set, not complete source/relinking coverage.

The package inventory also descends into ordinary nested `node_modules`, not only
the top-level and pnpm store. It tracks physical dependency-directory identities
to terminate cycles and rejects directories escaping the inspected root. This
matters for the npm tooling carried by the migration base. Existing inventory
counts that did not scan these nested packages retain their historical scope.

### Migration package-manager boundary

The final `migrate` target runs the dedicated locked Prisma CLI with `node`; it does not install
packages at startup. npm, Corepack, Yarn and their launchers are removed only from that final target.
The cleaned filesystem is copied into a fresh `scratch` final image so the removed tools are not
distributed in inherited lower layers. The `base`, dependency-install and build stages retain the
tools they need. CI runs
`scripts/verify-migration-runtime.mjs` against the actual final image to require a non-root user,
Prisma 6.19.3, the Node license, and absence of global Node packages, Yarn and package-manager launchers
(including dangling symlinks). A base or Prisma upgrade must revisit this boundary.
The final image invokes Node directly and also omits the unused base-image entrypoint shell script.
Migration stages precede application dependency/build stages so a resource-limited legacy Docker
build of `--target migrate` does not unnecessarily build the application first.

This removal addresses unnecessary distributed tools; it does not certify every remaining dependency
or embedded native component. Validate `migrate deploy` against both an empty synthetic database and
an older synthetic schema, then repeat it to check that no migrations remain. Bind those results to
the tested image, schema and migration checksums; a successful CLI help command is insufficient.

### Separate migration SBOM

`pnpm run sbom -- --role migration` captures the product Git snapshot but reads the dependency graph
from `docker/migrate/pnpm-lock.yaml` using pnpm's `list --lockfile-only`. It does not install packages
or add application fonts. The output records `worldloom:artifact-role=migration` and the exact lock
path/hash. The normal application SBOM continues to include its installed production graph and fonts.
The two locks can resolve different transitive versions; for example, the migration lock contains
`deepmerge-ts@7.1.5`, which is absent from the application graph examined during this audit.

CI validates both SBOMs against the pinned CycloneDX schema. Migration inventory is collected using
an immutable image ID, and the migration image carries the build's source revision and a distinct
title. `verify-build-evidence.mjs --role migration` requires a clean source SBOM, the migration root
package and lock, the matching image revision/title, and exact equality of the source/runtime npm
identity sets. Missing or extra packages, application SBOM substitution, and inventory from another
image fail correlation. Its evidence index remains conditional: package identity matching does not
establish native/embedded component completeness, vulnerability clearance or signed provenance.

Lock-only enumeration may lack installed package license metadata; it must not guess those licenses.
The actual image's separate strict notice inventory supplies the package declarations and notice-file
hashes and remains required. Local dirty-source SBOMs are candidates, not release evidence.

## Browser inputs and shared-library loading on ARM64

The November 20 production Webpack trace records 124 client dependency package
identities. All 124 match the production dependency notice inventory. This
count covers compiler inputs before tree shaking. Use the browser supplement
index for the actual documents and their relationship to the published npm
packages. [Browser supplement sources](../third_party/runtime-licenses/browser-components/sources.json)

The app image carries one shared libvips library for Sharp 0.35.5 on Linux
ARM64. Its native addon requests the ELF SONAME `libvips-cpp.so.8.18.7`.
The loader opens the packaged file at:

```text
/app/node_modules/.pnpm/@img+sharp-libvips-linux-arm64@1.3.4/node_modules/@img/sharp-libvips-linux-arm64/lib/libvips-cpp.so.8.18.7
```

To exercise library replacement in an isolated container, mount the candidate
library read-only at that file path. Resolve Sharp from Next's installed
package. The local packaging check used a separate copy of the distributed
library, confirmed its inode in `/proc/self/maps`, then encoded and decoded one
RGB pixel. A different build needs matching architecture, SONAME and ABI and
its own functional check. The reviewed source versions, archive hashes and
upstream build recipe are in the [native source index](../third_party/runtime-licenses/sharp-components/manifest.json).
