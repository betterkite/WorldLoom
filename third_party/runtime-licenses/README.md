# Version-matched upstream runtime notices

These are unmodified copies from upstream release tags, retained for WorldLoom issue
[#11](https://github.com/betterkite/WorldLoom/issues/11). SHA-256 checksums were compared against
the source URLs on 2026-09-24, with the updated Next and Sharp notices rechecked on 2026-11-20. They are review inputs, **not** proof that all binary redistribution
obligations are satisfied. The Next.js and ONNX license texts are staged into exact-version
packages in the 2026-09-27 local app/worker candidate. The 2026-09-30 candidates additionally
stage ONNX's complete upstream third-party notice and Sharp/libvips's component notice;
the Sharp packaging-script Apache license is still a review input, not substituted for native licenses.

| Local file | Exact upstream source | SHA-256 |
| --- | --- | --- |
| `next-env-16.4.5.LICENSE` | [Next.js v16.4.5 license](https://github.com/vercel/next.js/blob/v16.4.5/license.md) | `ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224` |
| `onnxruntime-1.30.0.LICENSE` | [ONNX Runtime v1.30.0 license](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE) | `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c` |
| `onnxruntime-1.30.0-ThirdPartyNotices.txt` | [ONNX Runtime v1.30.0 complete third-party notice](https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt) | `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3` |
| `sharp-libvips-1.3.4.LICENSE` | [sharp-libvips v1.3.4 packaging-script license](https://github.com/lovell/sharp-libvips/blob/v1.3.4/LICENSE) | `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` |
| `sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md` | [sharp-libvips v1.3.4 component notices](https://github.com/lovell/sharp-libvips/blob/v1.3.4/THIRD-PARTY-NOTICES.md) | `6f0d5086e3bcbee12bcdacf5878b31d1104002aeecaeb241d3fff466108082fe` |

The sharp-libvips LICENSE covers its packaging scripts, whereas the native shared library includes
several separately licensed components listed in the third-party notices. The notices enumerate
license families but do not themselves contain every underlying license text. ONNX Runtime also
publishes a large [v1.30.0 `ThirdPartyNotices.txt`](https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt)
(SHA-256 `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3`);
its relevance to the exact shipped binary and the correct distribution form still require a
qualified review. The `client-only@0.0.1` npm tarball has no adjacent notice and no version-linked
source license has yet been verified. Do not infer coverage for these components from the MIT or
Apache metadata alone.

2026-09-30: the full ONNX third-party file is retained byte-for-byte (338,088 bytes), without
selectively removing notices based on guessed linkage. `stage-versioned-runtime-notices.mjs`
pins source digests, exact package versions and declared licenses before any copy. It stages
`NOTICE.worldloom-onnxruntime.txt` next to ONNX Runtime Node and
`NOTICE.worldloom-sharp-libvips.md` next to the matching Linux arm64/x64 libvips package.
Unknown versions, conflicting files and symlink destinations fail closed. Sharp's component notice
only lists license families; including it improves disclosure but does not supply all underlying
license texts or establish LGPL obligations. Candidate strict inventories still fail on `client-only`.

2026-09-27 registry cross-check: `client-only@0.0.1` reports `license: MIT` and npm tarball
integrity `sha512-IV3Ou0jSMzZrd3pZ48nLkT9DA7Ag1pnPzaiQhpW7c3RbcqqzvzzVu+L8gfqMp/8IM2MQtSiqaCxrrcfu8I8rMA==`;
its installed tarball contains only `package.json`, `index.js` and `error.js`, with no repository
field or license text. The [React server-module RFC](https://github.com/reactjs/rfcs/blob/main/text/0227-server-module-conventions.md)
describes publishing this marker package and its conditional exports, but it does not provide a
version-linked permission notice. This improves provenance, **not** the release-gate result.


## Node in the pinned base images

[node-24.21.0.LICENSE](node-24.21.0.LICENSE) is the unmodified complete [upstream release notice](https://github.com/nodejs/node/blob/v24.21.0/LICENSE), including its bundled component notices. SHA-256: `5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace`. The pinned distroless base carries the same bytes at `/nodejs/LICENSE`; the pinned Node Debian base carries them at `/usr/local/LICENSE`. This source copy records the expected notice; Docker retains the original base-image file.

`base-image-copyright-audit.mjs / --strict --node-runtime` checks the actual running Node version, its expected notice location and the complete text digest in addition to Debian package copyright files. Review this binding when updating either Docker base. A passing Node check does not cover application/native libraries or establish all distribution obligations.
