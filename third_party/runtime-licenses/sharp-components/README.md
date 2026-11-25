# Sharp/libvips component notices

This directory preserves 59 nonempty, unmodified upstream notice, license, copyright, author and patent documents covering the 28 components declared by sharp-libvips 1.3.4. `manifest.json` pins component versions, original source URLs, archive paths and SHA-256 values. The 24 newly covered components were read from the exact archive URLs in the pinned POSIX build recipe; their compressed archives and source programs are not copied into the product. The earlier four-component originals remain unchanged.

The Docker staging step checks all 28 reviewed versions against the actual package's `versions.json`, verifies every notice digest and destination before any copy, and keeps the texts beside the Sharp/libvips package. Unknown versions, modified bytes or symlinks fail. It does not change the library binary. Source archive hashes identify retrieved bytes, not upstream signatures or an independent reproduction of that binary.

GLib's root `COPYING` is an archive symlink to `LICENSES/LGPL-2.1-or-later.txt`. The target and the archive's other original LICENSES texts are retained as regular files; the manifest records the link. No external filesystem symlink is followed. Empty pixman AUTHORS is recorded in the raw review but is not staged as an attribution text.

The set is conservative: source archives also include licenses for tools, tests and optional code. Including those texts does not claim those programs are shipped. In particular, proxy-libintl is conditional in the upstream recipe. FreeType's original license-choice notice, FTL and GPL texts are preserved; the upstream packaging notice selects the FreeType License. WorldLoom acknowledges its use of the FreeType Project. This software is based in part on the work of the Independent JPEG Group.

The exact cairo 1.18.6 COPYING offers LGPL-2.1 or MPL-1.1, whereas the packaging summary lists MPL-2.0. Both original files are preserved without rewriting either upstream declaration. This discrepancy remains for resolution against the actual licensed source; the text collection does not approve a substituted license.

These documents close the identified archive-level text omissions. File-specific notices referenced by FreeType, cairo, HarfBuzz and libarchive, Rust transitive dependencies, build patches and corresponding-source/relinking obligations still require their separate source-to-artifact review. A 28-component declaration or successful staging check is not complete redistribution clearance.

## Source-file declarations and build patches

Four additional FILE-NOTICES documents preserve unmodified original opening comments or complete README notices: nine FreeType files explicitly named in LICENSE.TXT, six libarchive implementation files named in COPYING, 285 cairo source files and 369 HarfBuzz source files. Byte-identical blocks are grouped with all source paths; WorldLoom's headings are distinguished from original text. The manifest records each original source hash, exact extracted block hash/byte range, and files without a leading declaration. These files are a conservative source-level set, not a linker map or a claim of exhaustive notices for every embedded library. The directory now has 63 notice documents.

FreeType's src/gzip/zlib.h declares zlib 1.3.1; its original license header is retained separately from top-level zlib-ng 2.3.3. The libarchive filter headers include the original UC Regents conditions. BLAKE2 headers preserve their declared license alternatives; they are not converted to a guessed grant. Additional non-leading declarations and dependencies still need source-to-artifact review.

The manifest also records SHA-256 values for all five patch URLs in the fixed POSIX recipe. The UltraHDR pull-request URL is mutable: its retrieved commits and digest describe this observed download, not a proven historical build input. The recipe additionally edits source inline and runs cargo update --workspace, so these five patches alone do not form a complete corresponding-source bundle. No patch was applied or executed by this review.
