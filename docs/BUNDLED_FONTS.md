# Bundled UI fonts

WorldLoom includes the existing five normal variable font families locally.
Builds and browsers do not fetch them from Google. No family, theme mapping,
weight range, original Unicode subset or Latin-only preload was removed.

| Family | Embedded version | Weight | Subsets |
| --- | --- | --- | --- |
| Geist | 1.800 | 100–900 | 5 |
| Geist Mono | 1.701 | 100–900 | 6 |
| Inter | 4.001; git-66647c0bb | 100–900 | 7 |
| JetBrains Mono | 2.211 | 100–800 | 6 |
| Playfair Display | 1.203 | 400–900 | 4 |

The 28 unmodified official WOFF2 files total 541,312 bytes. On 2026-10-05 all
matched the pre-existing local build's font files byte-for-byte. The acquisition
used the same User-Agent as the installed Next 16.3.5 Google-font downloader;
Google's response to a different User-Agent produced different files, so those
first downloads were replaced before use. No binary conversion/subsetting was
performed. Inter's delivered files retain only the weight axis, not a newly
introduced optical-size axis. This is source/asset evidence, not a browser
pixel-comparison result or proof that the running service uses this candidate.

`public/fonts/manifest.json` records each original CDN URL, file SHA-256, byte
size, Unicode range, preload, embedded version, copyright and license digest.
`google-fonts-source.txt` retains the official CSS response; it is provenance,
not an applied stylesheet. Full, unchanged OFL texts are adjacent to the fonts,
from the fixed Google Fonts catalog revision
`9710da1eacb3be272583c3224dcb70f9da6eadbb`. A catalog revision identifies the
license source, not a claim that a CDN file is identical to its upstream TTF.

Each font remains [OFL-1.1](../public/fonts/geist.OFL.txt), not MIT. All five
copyright/license texts must remain in source and app/worker distributions;
Playfair Display's original license also declares its Reserved Font Name.
This engineering inventory does not replace qualified review of all release
distribution obligations or resolve the other runtime-license gaps.

`src/components/themes/fonts.css` preserves the original Google Unicode ranges
and Next fallback metrics. `font.config.ts` retains the five CSS variable names;
the root layout preloads only the five Latin files. Chinese/system fallback and
the existing theme cascade are unchanged. A new visual/Edge check is still needed
before release; matching font bytes alone does not prove complete UI correctness.

The normal `pnpm build` now checks source assets, runs `next build`, then checks
the real production CSS. With `BUILD_STANDALONE=true` it also requires the
standalone server; ordinary builds retain their previous output mode. It does not mock Google, weaken
types or use an alternate build engine. The image payload checker repeats asset/
license/CSS checks after `public` and `.next/static` have been copied. Font file
components and original hashes/OFL references are included in production SBOMs;
release correlation rejects missing, duplicated or altered font records. The
migration-only image does not ship or need these UI font assets.
