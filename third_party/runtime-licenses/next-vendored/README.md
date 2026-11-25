# Next.js 16.4.5 direct-component notices

These twelve files are unmodified original LICENSE or README texts from the exact npm releases listed below. Full README files are retained where they carry the original license grant or CC0 declaration. `manifest.json` records registry URLs, tarball SHA-512 integrity, tarball SHA-256, original archive paths, text SHA-256 and the matching Next compiled payload hashes.

| Component | Declared license | Original text | Source |
| --- | --- | --- | --- |
| @edge-runtime/cookies@6.0.0 | MIT | [edge-runtime--cookies-6.0.0.NOTICE](edge-runtime--cookies-6.0.0.NOTICE) | [npm release](https://registry.npmjs.org/@edge-runtime%2Fcookies/6.0.0) |
| @edge-runtime/ponyfill@4.0.0 | MIT | [edge-runtime--ponyfill-4.0.0.NOTICE](edge-runtime--ponyfill-4.0.0.NOTICE) | [npm release](https://registry.npmjs.org/@edge-runtime%2Fponyfill/4.0.0) |
| @edge-runtime/primitives@6.0.0 | MIT | [edge-runtime--primitives-6.0.0.NOTICE](edge-runtime--primitives-6.0.0.NOTICE) | [npm release](https://registry.npmjs.org/@edge-runtime%2Fprimitives/6.0.0) |
| @modelcontextprotocol/sdk@1.18.1 | MIT | [modelcontextprotocol--sdk-1.18.1.NOTICE](modelcontextprotocol--sdk-1.18.1.NOTICE) | [npm release](https://registry.npmjs.org/@modelcontextprotocol%2Fsdk/1.18.1) |
| constants-browserify@1.0.0 | MIT | [constants-browserify-1.0.0.NOTICE](constants-browserify-1.0.0.NOTICE) | [npm release](https://registry.npmjs.org/constants-browserify/1.0.0) |
| data-uri-to-buffer@3.0.1 | MIT | [data-uri-to-buffer-3.0.1.NOTICE](data-uri-to-buffer-3.0.1.NOTICE) | [npm release](https://registry.npmjs.org/data-uri-to-buffer/3.0.1) |
| http-proxy-agent@5.0.0 | MIT | [http-proxy-agent-5.0.0.NOTICE](http-proxy-agent-5.0.0.NOTICE) | [npm release](https://registry.npmjs.org/http-proxy-agent/5.0.0) |
| https-proxy-agent@5.0.1 | MIT | [https-proxy-agent-5.0.1.NOTICE](https-proxy-agent-5.0.1.NOTICE) | [npm release](https://registry.npmjs.org/https-proxy-agent/5.0.1) |
| punycode@2.1.1 | MIT | [punycode-2.1.1.NOTICE](punycode-2.1.1.NOTICE) | [npm release](https://registry.npmjs.org/punycode/2.1.1) |
| setimmediate@1.0.5 | MIT | [setimmediate-1.0.5.NOTICE](setimmediate-1.0.5.NOTICE) | [npm release](https://registry.npmjs.org/setimmediate/1.0.5) |
| string-hash@1.1.3 | CC0-1.0 | [string-hash-1.1.3.NOTICE](string-hash-1.1.3.NOTICE) | [npm release](https://registry.npmjs.org/string-hash/1.1.3) |
| image-size@1.2.1 | MIT | [image-size-1.2.1.NOTICE](image-size-1.2.1.NOTICE) | [npm release](https://registry.npmjs.org/image-size/1.2.1) |

Version and destination mapping follows [Next's exact release manifest](https://github.com/vercel/next.js/blob/v16.4.5/packages/next/package.json) and [build taskfile](https://github.com/vercel/next.js/blob/v16.4.5/packages/next/taskfile.js). Their hashes are retained in the manifest. The image-detector component comes from image-size/dist/detector.js. Cookies matches its upstream dist/index.js byte-for-byte; ponyfill matches upstream src/index.js after the taskfile's require-path substitution. Other ncc bundles are bound to the actual Next package bytes and the declared input version; this is not a reproduction of upstream ncc builds.

The image copies this entire directory to `/app/third_party/next-vendored`, including the manifest and attribution links. The verifier rejects changed parent metadata, versions, notices, unexpected or changed traced payloads, and symlinks. It does not copy untraced code or change runtime JavaScript.

These are direct-component notices, not complete transitive attribution. Font/fontkit, Babel/cssnano, Next runtime/devtools, Unistore and native/browser/base-image reconciliation remain separate work. This bundle does not replace their licenses or establish legal approval. No generic MIT template has been substituted for an unknown upstream grant.

## Fontkit dependency supplement

Nine unmodified original texts are conservatively included for the production dependency closure of fontkit 2.0.2 in the exact Next 16.4.5 upstream lock. The manifest retains all thirteen locked dependency versions/integrities, the upstream fontkit entry and lock hashes, and binds each supplied notice to the actual compiled fontkit payload hash. This is not a reconstruction of the upstream bundler or a claim that every locked module was embedded. The verifier checks every supplied text and any traced bound payload; it allows that payload to be absent from a trace.

- base64-js@1.5.1: [base64-js-1.5.1.NOTICE](base64-js-1.5.1.NOTICE) (MIT).
- clone@2.1.2: [clone-2.1.2.NOTICE](clone-2.1.2.NOTICE) (MIT).
- fast-deep-equal@3.1.3: [fast-deep-equal-3.1.3.NOTICE](fast-deep-equal-3.1.3.NOTICE) (MIT).
- pako@0.2.9: [pako-0.2.9.NOTICE](pako-0.2.9.NOTICE) (MIT).
- restructure@3.0.0: [restructure-3.0.0.NOTICE](restructure-3.0.0.NOTICE) (MIT).
- tiny-inflate@1.0.3: [tiny-inflate-1.0.3.NOTICE](tiny-inflate-1.0.3.NOTICE) (MIT).
- tslib@2.8.1: [tslib-2.8.1.NOTICE](tslib-2.8.1.NOTICE) (0BSD).
- unicode-properties@1.4.1: [unicode-properties-1.4.1.NOTICE](unicode-properties-1.4.1.NOTICE) (MIT).
- unicode-trie@2.0.0: [unicode-trie-2.0.0.NOTICE](unicode-trie-2.0.0.NOTICE) (MIT).

Original full texts remain unresolved for @swc/helpers 0.4.14, brotli 1.3.3, dfa 1.2.0 and fontkit 2.0.2. Their MIT metadata or a README containing only “MIT” is not represented here as a recovered original grant. This supplement does not close fontkit or the overall release audit.

## Brotli decoder declarations

The exact brotli 1.3.3 archive declares MIT in package metadata, but seven decoder files explicitly carry Google copyright and Apache-2.0 headers. [brotli-1.3.3-decoder.NOTICE](brotli-1.3.3-decoder.NOTICE) retains those seven leading comments verbatim with labelled source paths. [Apache-2.0.LICENSE](Apache-2.0.LICENSE) is the unmodified [Apache Software Foundation license text](https://www.apache.org/licenses/LICENSE-2.0.txt) designated by those headers. The manifest records the exact tarball integrity, full source and header hashes, and compiled fontkit binding. The notice preface and source labels are WorldLoom additions; the original comments are unchanged.

These two supplemental files cover the identified decoder declarations. They do not replace the package-level MIT declaration or close the missing wrapper grant, fontkit and other transitive attribution work. Package SPDX metadata alone does not establish all bundled file licenses.

## Later upstream fontkit license

The fontkit maintainers merged [PR #300](https://github.com/foliojs/fontkit/pull/300) on 2026-11-02. [fontkit-upstream-d65a577.LICENSE](fontkit-upstream-d65a577.LICENSE) preserves the original text from commit `d65a577ea30bfce9ce84dc8045860b2abbc1968b`, verified against Git blob `34d142021809672bcbbd880ec9c8957d9c474dd2`. This is a later project-level notice, not a file recovered from the 2.0.2 npm archive. Its association with the traced 2.0.2 bytes is recorded for attribution; the original exact-release/inherited-notice question remains open. No copyright holder, year, or grant was generated locally, and the older unresolved list is retained.

## Exact SWC helpers source attribution

[swc-helpers-0.4.14.provenance.json](swc-helpers-0.4.14.provenance.json) identifies the original publish commit `e59ccfc80077e38c28f5862baef4ec2fc33955b3`. The registry omits `gitHead`; the commit is established from the upstream version history, matching package version and all 96 source files in the integrity-verified npm archive. Both source path sets and every Git blob hash match. This closes the previously unknown release source location without claiming reproduction of the generated CommonJS files or Next's embedded bundle.

The package manifest at that exact commit declares MIT, while the repository root contains Apache-2.0. No package-local license text was recovered. The provenance records both facts and keeps the package's original/inherited notice question open; the root license is not used as a substitute grant. This JSON is source attribution evidence, not an extra license or a legal-clearance result.

## Original license declarations and designated provider

The original package manifests for `@swc/helpers@0.4.14`, `brotli@1.3.3`,
`dfa@1.2.0`, `fontkit@2.0.2` and `unistore@3.4.1`, plus the four available
release READMEs, are retained as `*.package-json.NOTICE` and `*.README.NOTICE`.
They are byte-for-byte archive extracts, including their authorship and MIT
declarations. Their hashes and the relevant compiled payload hashes are checked
by the supplemental notice verifier. A missing standalone LICENSE file must not
be reported as an absence of an upstream license declaration. These declarations
do not override different source-file notices such as the Brotli decoder headers.

Unistore's original README explicitly credits **Jason Miller** and designates
`https://oss.ninja/mit/developit`. The author's
[provider source](https://github.com/developit/oss.ninja/tree/92643be13a90935a93b0c51e4ebf54e24371de1e)
loads templates from `license.js` with a declared `^2.1.0` dependency. Its renderer
fills the organization from the GitHub profile and the year from the request
date. [unistore-designated-MIT.template.txt](unistore-designated-MIT.template.txt)
preserves the original MIT template from the integrity-checked `license.js@2.1.0`
archive. The placeholders remain unchanged; no year or copyright holder was
invented or inserted into it.

This recovers the designated provider's source and a template permitted by its
declared dependency range. It is not a captured historical website response or
proof of which exact template version that deployment used. The manifest keeps
those limits separate from the confirmed Unistore declaration and attribution.
The standalone-original-text and inherited-notice questions above remain open;
the new files are additional primary evidence, not a blanket clearance claim.
