# Third-party notices

WorldLoom is distributed under the MIT License in [`LICENSE`](./LICENSE). This file records the
third-party code and dependency attributions that must remain with a distributable build. It is an
engineering inventory, not legal advice; review it again when dependencies or deployment artifacts
change.

## Reused source code

The application shell and part of the UI component structure include code from
[`Kiranism/next-shadcn-dashboard-starter`](https://github.com/Kiranism/next-shadcn-dashboard-starter),
licensed under the MIT License, Copyright (c) 2023 Kiranism. The corresponding notice is retained
below:

> MIT License
>
> Copyright (c) 2023 Kiranism
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The project also uses MIT-licensed [shadcn/ui](https://ui.shadcn.com/) component conventions.

### Local embedding model

The optional local semantic fallback uses [`@huggingface/transformers`](https://github.com/huggingface/transformers.js),
licensed under the Apache License 2.0, to run ONNX inference in Node.js. The downloaded
[`Xenova/bge-m3`](https://huggingface.co/Xenova/bge-m3) model is MIT-licensed and is stored in the
gitignored `.cache/worldloom-embeddings/` directory; it is not committed to this repository.

### Bundled UI fonts

WorldLoom self-hosts the existing Geist, Geist Mono, Inter, JetBrains Mono and
Playfair Display normal variable fonts. Unmodified official WOFF2 subsets and
each complete SIL Open Font License 1.1 are in `public/fonts/`; `manifest.json`
records exact sources, versions, SHA-256 digests, copyright and the fixed Google
Fonts license-catalog revision. Playfair Display has a Reserved Font Name.
These font files remain OFL-1.1, not the project's MIT license. They are copied
with `public` into app/worker images and verified against actual production CSS.
See [the font inventory](public/fonts/README.md); no Google request is needed to
build or render these fonts. This does not approve other distribution obligations.

## Dependency license inventory

The lockfile currently resolves dependencies under these license families:

- MIT
- Apache-2.0
- ISC
- BSD-2-Clause and BSD-3-Clause
- MPL-2.0 (`lightningcss`)
- 0BSD (`tslib`)
- MIT OR CC0-1.0 (`type-fest`)
- CC0-1.0 (`railroad-diagrams`, development/CI validator dependency)
- LGPL-3.0-or-later (Sharp/libvips platform package)
- CC-BY-4.0 (`caniuse-lite` data)

Notable non-MIT packages in the current install include:

- `reagraph`, `@prisma/client`, `sharp`, `@playwright/test`, and `typescript` — Apache-2.0.
- `lightningcss` — MPL-2.0.
- Sharp's platform libvips package — LGPL-3.0-or-later.
- `caniuse-lite` — CC-BY-4.0 for browser-compatibility data.
- D3 packages, `yaml`, and related utilities — ISC.

The development-only CycloneDX validator uses `ajv`, `ajv-formats` and
`ajv-formats-draft2019` (MIT). Its transitive `railroad-diagrams@1.0.0` package by Tab Atkins Jr.
declares CC0-1.0 in both its README and JavaScript header; these exact installed files were checked
on 2026-09-30. The [upstream project](https://github.com/tabatkins/railroad-diagrams) and
[CC0 1.0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en) are source
references. This dependency is used for schema validation tooling, not by WorldLoom's application code.

Before publishing a release, regenerate and review the complete transitive inventory:

```sh
pnpm licenses list --json
pnpm audit
```

Where a dependency's license text or attribution is required by its terms, retain the license
provided by that dependency in the distribution artifact. Do not treat this summary as a substitute
for the package-provided license files.

### Production dependency originals

The application/worker Docker build collects original package declarations and notice files
from the installed production dependency graph into `/app/third_party/production-dependencies`.
This deliberately includes dependencies that may be embedded in browser chunks, even when
they do not have a standalone package directory in the server image. Its manifest records
versions, original relative paths, exact file hashes, and the source lockfile hash. Each
`.NOTICE` file retains the original bytes; the extension does not change the upstream terms.

The manifest distinguishes notice files, README fallback, and declarations with no additional
text. It also records absent optional platform branches with their parent declarations.
This conservative collection is not a claim that every listed package is embedded, or that
all vendored/native source headers and corresponding-source obligations are covered. The
versioned Next and native notice supplements below remain necessary.

The [browser component source index](third_party/runtime-licenses/browser-components/sources.json)
lists original license texts for React Three Fiber 9.7.0 and Draco 1.5.7, and
supplemental notices for MediaPipe Tasks Vision 0.10.17 and react-remove-scroll-bar
2.3.8. MediaPipe attribution headers come from the locked npm declaration file
and JavaScript source map. Its upstream license file is identical at tags
v0.10.15 and v0.10.18. For react-remove-scroll-bar, every published file except
package.json matches 2.3.7. The upstream author subsequently added the included
license to that code. The index records the original bytes and source revisions.
The runtime stores these originals under `/app/third_party/browser-components/`.

## Release checklist

- Keep this file and `LICENSE` in source distributions and container source archives.
- Re-run the inventory after every dependency update and record any new license family here.
- Confirm that optional deployment artifacts do not add proprietary or non-commercial UI assets.
- Confirm that all required attribution files remain in source distributions and release archives.


## Next.js embedded direct-component notices

Twelve original exact-release notices and their code/source bindings are retained in [the Next vendored notice bundle](third_party/runtime-licenses/next-vendored/README.md). The runtime image ships it at `/app/third_party/next-vendored`. This supplements the package notices without claiming complete coverage of bundled transitive code, native libraries or browser artifacts.


## Sharp native component notices

This software is based in part on the work of the Independent JPEG Group.

The [Sharp/libvips component notice bundle](third_party/runtime-licenses/sharp-components/README.md) preserves exact upstream files for libvips, cgif, libimagequant and mozjpeg, including the referenced IJG README. These supplement the existing packaging-level component list; other notices and corresponding-source obligations remain separate.

### Native library source notices

WorldLoom uses the FreeType Project through Sharp/libvips; the original FreeType license-choice notice and complete FreeType License are retained in [the component notice directory](third_party/runtime-licenses/sharp-components/README.md). That directory now supplies original archive-level documents for all 28 components declared by the fixed upstream build, including AOM/WebP patent notices and GLib's license-directory targets. Its manifest records exact versions, source archives and hashes. Original differing cairo license declarations and the remaining file-level/source obligations are explicitly preserved for review.
