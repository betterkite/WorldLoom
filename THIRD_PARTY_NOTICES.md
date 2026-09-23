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

> Copyright (c) 2023 Kiranism
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the “Software”), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
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

## Dependency license inventory

The lockfile currently resolves dependencies under these license families:

- MIT
- Apache-2.0
- ISC
- BSD-2-Clause and BSD-3-Clause
- MPL-2.0 (`lightningcss`)
- 0BSD (`tslib`)
- MIT OR CC0-1.0 (`type-fest`)
- LGPL-3.0-or-later (Sharp/libvips platform package)
- CC-BY-4.0 (`caniuse-lite` data)

Notable non-MIT packages in the current install include:

- `reagraph`, `@prisma/client`, `sharp`, `@playwright/test`, and `typescript` — Apache-2.0.
- `lightningcss` — MPL-2.0.
- Sharp's platform libvips package — LGPL-3.0-or-later.
- `caniuse-lite` — CC-BY-4.0 for browser-compatibility data.
- D3 packages, `yaml`, and related utilities — ISC.

Before publishing a release, regenerate and review the complete transitive inventory:

```sh
pnpm licenses list --json
pnpm audit
```

Where a dependency's license text or attribution is required by its terms, retain the license
provided by that dependency in the distribution artifact. Do not treat this summary as a substitute
for the package-provided license files.

## Release checklist

- Keep this file and `LICENSE` in source distributions and container source archives.
- Re-run the inventory after every dependency update and record any new license family here.
- Confirm that optional deployment artifacts do not add proprietary or non-commercial UI assets.
- Confirm that all required attribution files remain in source distributions and release archives.
