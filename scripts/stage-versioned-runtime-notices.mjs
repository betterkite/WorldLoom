#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inventoryRuntimePackages } from './runtime-license-audit.mjs';

// Exact upstream release files. This only supplies package notices; it does not
// certify native subcomponents, bundled JavaScript, OS packages or legal duties.
const sources = [
  {
    package: '@next/env@16.4.5',
    declaredLicense: 'MIT',
    filename: 'next-env-16.4.5.LICENSE',
    destination: 'LICENSE.worldloom-upstream',
    sha256: 'ee765244e2d59f5234d474f62e0766fa0c8b99af967fdd4c0cb8dcb0c76ea224'
  },
  {
    package: 'onnxruntime-common@1.30.0',
    declaredLicense: 'MIT',
    filename: 'onnxruntime-1.30.0.LICENSE',
    destination: 'LICENSE.worldloom-upstream',
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'
  },
  {
    package: 'onnxruntime-node@1.30.0',
    declaredLicense: 'MIT',
    filename: 'onnxruntime-1.30.0.LICENSE',
    destination: 'LICENSE.worldloom-upstream',
    sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'
  },
  {
    package: 'onnxruntime-node@1.30.0',
    declaredLicense: 'MIT',
    filename: 'onnxruntime-1.30.0-ThirdPartyNotices.txt',
    destination: 'NOTICE.worldloom-onnxruntime.txt',
    sha256: '143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3'
  }
];
const sharpNotice = {
  declaredLicense: 'LGPL-3.0-or-later',
  filename: 'sharp-libvips-1.3.4-THIRD-PARTY-NOTICES.md',
  destination: 'NOTICE.worldloom-sharp-libvips.md',
  sha256: '6f0d5086e3bcbee12bcdacf5878b31d1104002aeecaeb241d3fff466108082fe'
};
const sharpComponentVersions = {
  "aom": "3.15.1",
  "archive": "3.8.9",
  "cairo": "1.18.6",
  "cgif": "0.5.4",
  "exif": "0.6.26",
  "expat": "2.8.5",
  "ffi": "3.8.0",
  "fontconfig": "2.18.3",
  "freetype": "2.14.3",
  "fribidi": "1.0.17",
  "glib": "2.90.0",
  "harfbuzz": "14.5.0",
  "heif": "1.23.5",
  "highway": "1.4.0",
  "imagequant": "2.4.1",
  "lcms": "2.19.1",
  "mozjpeg": "0826579",
  "pango": "1.58.2",
  "pixman": "0.46.4",
  "png": "1.6.58",
  "proxy-libintl": "0.5",
  "rsvg": "2.63.2",
  "tiff": "4.7.2",
  "uhdr": "2.0.2",
  "vips": "8.18.7",
  "webp": "1.6.0",
  "xml2": "2.15.4",
  "zlib-ng": "2.3.3"
};
const sharpOriginalSources = [
  {
    "filename": "sharp-components/vips-8.18.7.LICENSE",
    "destination": "NOTICE.worldloom-vips-8.18.7.LICENSE",
    "sha256": "dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551"
  },
  {
    "filename": "sharp-components/imagequant-2.4.1.COPYRIGHT",
    "destination": "NOTICE.worldloom-imagequant-2.4.1.COPYRIGHT",
    "sha256": "7391bfbcde4404cefb9849553362c3ab436f929f5cc1abb57071ec045590ee99"
  },
  {
    "filename": "sharp-components/cgif-0.5.4.LICENSE",
    "destination": "NOTICE.worldloom-cgif-0.5.4.LICENSE",
    "sha256": "7264dede477abab4ac3fe8236beb8153845c04ccd33b18f281085087e219fc6d"
  },
  {
    "filename": "sharp-components/mozjpeg-0826579.LICENSE.md",
    "destination": "NOTICE.worldloom-mozjpeg-0826579.LICENSE.md",
    "sha256": "96f5b328adbb78eeaaec6980d73fd558cb1e4d62560ed615646bc3cf5e532430"
  },
  {
    "filename": "sharp-components/mozjpeg-0826579.README.ijg",
    "destination": "NOTICE.worldloom-mozjpeg-0826579.README.ijg",
    "sha256": "f4a85f8677ca4e41b185c0a9f7c31a30ddb9ce43c561483ee92ef12db37c2a10"
  },
  {
    "filename": "sharp-components/proxy-libintl-0.5.COPYING",
    "destination": "NOTICE.worldloom-proxy-libintl-0.5.COPYING",
    "sha256": "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5"
  },
  {
    "filename": "sharp-components/zlib-ng-2.3.3.LICENSE.md",
    "destination": "NOTICE.worldloom-zlib-ng-2.3.3.LICENSE.md",
    "sha256": "6c9f0d975b41afaa34d22f55bb8986ce69e5cb7ad327cb2b28820cd425edf5ee"
  },
  {
    "filename": "sharp-components/ffi-3.8.0.LICENSE-BUILDTOOLS",
    "destination": "NOTICE.worldloom-ffi-3.8.0.LICENSE-BUILDTOOLS",
    "sha256": "e67978cd18816c0cb7d29aaaacde7b7447402c2fb321a051698890a8eaedda94"
  },
  {
    "filename": "sharp-components/ffi-3.8.0.LICENSE",
    "destination": "NOTICE.worldloom-ffi-3.8.0.LICENSE",
    "sha256": "17b64dc60f3b6897a60f971e288b973f655c2edcdf08b25f3c3dd5549857881c"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__AFL-2.0.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__AFL-2.0.txt",
    "sha256": "7ecc7db84298adb05d2cf10339c63a5315a1c5c270a68d97d7d40a53b508ccde"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__Apache-2.0.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__Apache-2.0.txt",
    "sha256": "074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__CC-BY-SA-3.0.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__CC-BY-SA-3.0.txt",
    "sha256": "3f941b3b89cf7b8370ceb83cc76d2120d471b58735d8ca60238a751a48d7f72f"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__CC0-1.0.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__CC0-1.0.txt",
    "sha256": "a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__GPL-2.0-or-later.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__GPL-2.0-or-later.txt",
    "sha256": "aaf135472f81c5b4a0dca9367e5bb5e9750032b5bebe5442b36e4c0a47430df3"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__LGPL-2.1-only.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__LGPL-2.1-only.txt",
    "sha256": "fa6f36630bb1e0c571d34b2bbdf188d08495c9dbf58f28cac112f303fc1f58fb"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__LGPL-2.1-or-later.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__LGPL-2.1-or-later.txt",
    "sha256": "fa6f36630bb1e0c571d34b2bbdf188d08495c9dbf58f28cac112f303fc1f58fb"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__LLVM-exception.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__LLVM-exception.txt",
    "sha256": "e34c58338bd89d43e709e226610d8f32b3e3c47f4ad9a99a8dc1d4ac7842488e"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__LicenseRef-old-glib-tests.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__LicenseRef-old-glib-tests.txt",
    "sha256": "fb261b2d5dbe76c4850f90da763210bc385e52428df6bbfd7b06295ac8a32914"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__MIT.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__MIT.txt",
    "sha256": "b85dcd3e453d05982552c52b5fc9e0bdd6d23c6f8e844b984a88af32570b0cc0"
  },
  {
    "filename": "sharp-components/glib-2.90.0.LICENSES__MPL-1.1.txt",
    "destination": "NOTICE.worldloom-glib-2.90.0.LICENSES__MPL-1.1.txt",
    "sha256": "6214f8b1300bb9f37b16ebc146f8f61af0187e0025042ff95c8b3030744a8795"
  },
  {
    "filename": "sharp-components/xml2-2.15.4.Copyright",
    "destination": "NOTICE.worldloom-xml2-2.15.4.Copyright",
    "sha256": "5d4873884a890122a4b9b20ad56ac6f7da1d796a5bfcf04a427970ac96217626"
  },
  {
    "filename": "sharp-components/exif-0.6.26.AUTHORS",
    "destination": "NOTICE.worldloom-exif-0.6.26.AUTHORS",
    "sha256": "a19ef6f43014fc57829658087d0c2bf59d97482e015cf553d7a68124603cbc44"
  },
  {
    "filename": "sharp-components/exif-0.6.26.COPYING",
    "destination": "NOTICE.worldloom-exif-0.6.26.COPYING",
    "sha256": "36b6d3fa47916943fd5fec313c584784946047ec1337a78b440e5992cb595f89"
  },
  {
    "filename": "sharp-components/lcms-2.19.1.LICENSE",
    "destination": "NOTICE.worldloom-lcms-2.19.1.LICENSE",
    "sha256": "6dbd60437f8ef91d8de1f08ad75882547fd4931bfcc3566a0735f28db1484d31"
  },
  {
    "filename": "sharp-components/lcms-2.19.1.AUTHORS",
    "destination": "NOTICE.worldloom-lcms-2.19.1.AUTHORS",
    "sha256": "4847d97cd41e980794939b1d2694bd8f67b92856ec80e95c2fcfc34066f0df93"
  },
  {
    "filename": "sharp-components/aom-3.15.1.AUTHORS",
    "destination": "NOTICE.worldloom-aom-3.15.1.AUTHORS",
    "sha256": "c31b80ca48fde06ca03aef2f3dec15413fe0c2661fe6b56e86ccd69dbc6f9a1d"
  },
  {
    "filename": "sharp-components/aom-3.15.1.LICENSE",
    "destination": "NOTICE.worldloom-aom-3.15.1.LICENSE",
    "sha256": "4764a286d8b2faeaf42f4418e7d7a28d58fc8fd4d00a3d0a7f44b0a4099de7f2"
  },
  {
    "filename": "sharp-components/aom-3.15.1.PATENTS",
    "destination": "NOTICE.worldloom-aom-3.15.1.PATENTS",
    "sha256": "661fb8e504744e95587b556b94a58343448300606a41bea8c7a9b97125696e61"
  },
  {
    "filename": "sharp-components/heif-1.23.5.COPYING",
    "destination": "NOTICE.worldloom-heif-1.23.5.COPYING",
    "sha256": "fa81ce652315b013359d6e8e4744335f31a50c7c192907176d3632f78a3b4596"
  },
  {
    "filename": "sharp-components/png-1.6.58.AUTHORS",
    "destination": "NOTICE.worldloom-png-1.6.58.AUTHORS",
    "sha256": "0c777e9f2a67bd4058ab91050eb7a56106c92ed038ba8fe5f54c83344f2d93ca"
  },
  {
    "filename": "sharp-components/png-1.6.58.LICENSE",
    "destination": "NOTICE.worldloom-png-1.6.58.LICENSE",
    "sha256": "bdb0a645ea18c60507d0368379b1ac5474b92255fcc2d115e07486a7672ba526"
  },
  {
    "filename": "sharp-components/webp-1.6.0.PATENTS",
    "destination": "NOTICE.worldloom-webp-1.6.0.PATENTS",
    "sha256": "cc3273e0694ea5896145e0677699b53471b03ea43021ddc50e7923fbb9f5023c"
  },
  {
    "filename": "sharp-components/webp-1.6.0.COPYING",
    "destination": "NOTICE.worldloom-webp-1.6.0.COPYING",
    "sha256": "5aec868f669e384a22372a4e8a1a6cd7d44c64cd451f960ca69cc170d1e13acf"
  },
  {
    "filename": "sharp-components/webp-1.6.0.AUTHORS",
    "destination": "NOTICE.worldloom-webp-1.6.0.AUTHORS",
    "sha256": "f251be89fd442bd9d701360730aea163cc8e2076ff03528f59267dc2c4f8b60a"
  },
  {
    "filename": "sharp-components/tiff-4.7.2.LICENSE.md",
    "destination": "NOTICE.worldloom-tiff-4.7.2.LICENSE.md",
    "sha256": "0e27c2382d7b8147972bbb746e04059a1152c8d0fda9d03ef1399d1a433c4ade"
  },
  {
    "filename": "sharp-components/highway-1.4.0.LICENSE",
    "destination": "NOTICE.worldloom-highway-1.4.0.LICENSE",
    "sha256": "e340270d4f64384569a91d546acb5b094d69ce47f0c015db77abb74dc6f815af"
  },
  {
    "filename": "sharp-components/freetype-2.14.3.LICENSE.TXT",
    "destination": "NOTICE.worldloom-freetype-2.14.3.LICENSE.TXT",
    "sha256": "bd36c8b474855fa294c2ec5c184544478ef3720aad37d65a6296a4f264fd2d3b"
  },
  {
    "filename": "sharp-components/freetype-2.14.3.docs__FTL.TXT",
    "destination": "NOTICE.worldloom-freetype-2.14.3.docs__FTL.TXT",
    "sha256": "5a5ee54c5001bbad1cdc1a57cc3dd4c42199b2da09d39c7ee41fab002d02967f"
  },
  {
    "filename": "sharp-components/freetype-2.14.3.docs__GPLv2.TXT",
    "destination": "NOTICE.worldloom-freetype-2.14.3.docs__GPLv2.TXT",
    "sha256": "c4120c6752c910c299e3bd9cb3a46ff262c268303ca2069b61f92f10a5656c18"
  },
  {
    "filename": "sharp-components/expat-2.8.5.COPYING",
    "destination": "NOTICE.worldloom-expat-2.8.5.COPYING",
    "sha256": "31b15de82aa19a845156169a17a5488bf597e561b2c318d159ed583139b25e87"
  },
  {
    "filename": "sharp-components/expat-2.8.5.AUTHORS",
    "destination": "NOTICE.worldloom-expat-2.8.5.AUTHORS",
    "sha256": "59f14371c6b75912cfebb46e6247ee5146766e803a0365b124e5d3011e7d0877"
  },
  {
    "filename": "sharp-components/archive-3.8.9.COPYING",
    "destination": "NOTICE.worldloom-archive-3.8.9.COPYING",
    "sha256": "30e556b3959e3985d66efefec5eaac51d4995053caa1d3cffe6eb916f146f229"
  },
  {
    "filename": "sharp-components/fontconfig-2.18.3.AUTHORS",
    "destination": "NOTICE.worldloom-fontconfig-2.18.3.AUTHORS",
    "sha256": "db6d73a160bb2de10268f88ef60aae91771fefdeee4992b791c76ce6592a4a4b"
  },
  {
    "filename": "sharp-components/fontconfig-2.18.3.COPYING",
    "destination": "NOTICE.worldloom-fontconfig-2.18.3.COPYING",
    "sha256": "51a51aa9823704fd90bccc616cdd17ebabb5b2b3e9cbde886ca02c7002288067"
  },
  {
    "filename": "sharp-components/harfbuzz-14.5.0.AUTHORS",
    "destination": "NOTICE.worldloom-harfbuzz-14.5.0.AUTHORS",
    "sha256": "19bfe8f5ed100636cd24ab0c90a3f71c21d8b02d9ba00719447a0faab364d49f"
  },
  {
    "filename": "sharp-components/harfbuzz-14.5.0.COPYING",
    "destination": "NOTICE.worldloom-harfbuzz-14.5.0.COPYING",
    "sha256": "ba8f810f2455c2f08e2d56bb49b72f37fcf68f1f4fade38977cfd7372050ad64"
  },
  {
    "filename": "sharp-components/pixman-0.46.4.COPYING",
    "destination": "NOTICE.worldloom-pixman-0.46.4.COPYING",
    "sha256": "fac9270f0987b96ff4533fca3548c633e02083cbba4a0172a3b149b2e4019793"
  },
  {
    "filename": "sharp-components/cairo-1.18.6.AUTHORS",
    "destination": "NOTICE.worldloom-cairo-1.18.6.AUTHORS",
    "sha256": "7118b55c2d911781622ecb281d9e11fd7eeb5f46c8925e6d740f96f89e79a8fe"
  },
  {
    "filename": "sharp-components/cairo-1.18.6.COPYING",
    "destination": "NOTICE.worldloom-cairo-1.18.6.COPYING",
    "sha256": "67228a9f7c5f9b67c58f556f1be178f62da4d9e2e6285318d8c74d567255abdf"
  },
  {
    "filename": "sharp-components/cairo-1.18.6.COPYING-LGPL-2.1",
    "destination": "NOTICE.worldloom-cairo-1.18.6.COPYING-LGPL-2.1",
    "sha256": "9e9e8608c4cdda51a78cc3a385f4ec9a2e4c96d5ecad74ac8bca5fca3e563b7d"
  },
  {
    "filename": "sharp-components/cairo-1.18.6.COPYING-MPL-1.1",
    "destination": "NOTICE.worldloom-cairo-1.18.6.COPYING-MPL-1.1",
    "sha256": "53692a2ed6c6a2c6ec9b32dd0b820dfae91e0a1fcdf625ca9ed0bdf8705fcc4f"
  },
  {
    "filename": "sharp-components/fribidi-1.0.17.AUTHORS",
    "destination": "NOTICE.worldloom-fribidi-1.0.17.AUTHORS",
    "sha256": "cb173f55c9514c8f38f4647ac3fedd5f8611358d331e65ab955da931e826861c"
  },
  {
    "filename": "sharp-components/fribidi-1.0.17.COPYING",
    "destination": "NOTICE.worldloom-fribidi-1.0.17.COPYING",
    "sha256": "20e50fe7aae3e56378ebf0417d9de904f55a0e61e4df315333e632a4d3555d95"
  },
  {
    "filename": "sharp-components/pango-1.58.2.COPYING",
    "destination": "NOTICE.worldloom-pango-1.58.2.COPYING",
    "sha256": "d245807f90032872d1438d741ed21e2490e1175dc8aa3afa5ddb6c8e529b58e5"
  },
  {
    "filename": "sharp-components/rsvg-2.63.2.AUTHORS",
    "destination": "NOTICE.worldloom-rsvg-2.63.2.AUTHORS",
    "sha256": "14e765b9c1097d93f4b842a6ad23172b530cc00dfe7a5aae1b9afefdca54531b"
  },
  {
    "filename": "sharp-components/rsvg-2.63.2.COPYING.LIB",
    "destination": "NOTICE.worldloom-rsvg-2.63.2.COPYING.LIB",
    "sha256": "dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551"
  },
  {
    "filename": "sharp-components/uhdr-2.0.2.LICENSE",
    "destination": "NOTICE.worldloom-uhdr-2.0.2.LICENSE",
    "sha256": "c9247b5cb07866938643cc238292434e6f2af8642e1fce10771c0e4cc7909316"
  },
  {
    "filename": "sharp-components/uhdr-2.0.2.LICENSE-APACHE",
    "destination": "NOTICE.worldloom-uhdr-2.0.2.LICENSE-APACHE",
    "sha256": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
  },
  {
    "filename": "sharp-components/uhdr-2.0.2.LICENSE-MIT",
    "destination": "NOTICE.worldloom-uhdr-2.0.2.LICENSE-MIT",
    "sha256": "029624bf1488ed7b8c92727d267c95f588c9c12fa6932c207884c2641a7e9d37"
  },
  {
    "filename": "sharp-components/freetype-2.14.3.FILE-NOTICES.txt",
    "destination": "NOTICE.worldloom-freetype-2.14.3.FILE-NOTICES.txt",
    "sha256": "81c68bba7b30fdf472d6e8f00c70b016a12a616a6ee2a30ddef813fc52c5a018"
  },
  {
    "filename": "sharp-components/archive-3.8.9.FILE-NOTICES.txt",
    "destination": "NOTICE.worldloom-archive-3.8.9.FILE-NOTICES.txt",
    "sha256": "f45b41fd564fbef049047142d38e0f3d091c5755a5935ba238cee33dca0e861f"
  },
  {
    "filename": "sharp-components/cairo-1.18.6.FILE-NOTICES.txt",
    "destination": "NOTICE.worldloom-cairo-1.18.6.FILE-NOTICES.txt",
    "sha256": "07df003e43a3e471d65e5c6b8619d39404b56fda6dd02cdcbe428237eb0a7f2e"
  },
  {
    "filename": "sharp-components/harfbuzz-14.5.0.FILE-NOTICES.txt",
    "destination": "NOTICE.worldloom-harfbuzz-14.5.0.FILE-NOTICES.txt",
    "sha256": "97679a294ff53dc50628bcb2a6f5b0ca78b5d2cfefd01833951e7405560ba501"
  }
];
const supportedSharpPackages = new Set([
  '@img/sharp-libvips-linux-arm64@1.3.4',
  '@img/sharp-libvips-linux-x64@1.3.4'
]);

const digest = (contents) => createHash('sha256').update(contents).digest('hex');

export function stageVersionedRuntimeNotices(root, sourceDirectory) {
  const appRoot = realpathSync(resolve(root));
  const sourceRoot = realpathSync(resolve(sourceDirectory));
  const packages = new Map(
    inventoryRuntimePackages(appRoot, { scanNativeFiles: false }).packages.map((entry) => [
      `${entry.name}@${entry.version}`,
      entry
    ])
  );
  const sharpPackages = [...packages.keys()].filter((name) => name.startsWith('@img/sharp-libvips-'));
  if (sharpPackages.length !== 1 || !supportedSharpPackages.has(sharpPackages[0])) {
    throw new Error('expected one supported exact-version Linux Sharp/libvips package');
  }
  const sharpEntry = packages.get(sharpPackages[0]);
  // The package version alone does not identify its embedded native components.
  for (const location of sharpEntry.locations) {
    const directory = realpathSync(join(appRoot, location));
    const versionPath = join(directory, 'versions.json');
    if (!directory.startsWith(appRoot + sep) || !lstatSync(versionPath).isFile()) {
      throw new Error('Sharp component versions must be a regular in-root file');
    }
    const declared = JSON.parse(readFileSync(versionPath, 'utf8'));
    for (const [name, version] of Object.entries(sharpComponentVersions)) {
      if (declared[name] !== version) throw new Error(`Sharp component version changed: ${name}`);
    }
  }
  const applicableSources = [
    ...sources,
    { ...sharpNotice, package: sharpPackages[0] },
    ...sharpOriginalSources.map((source) => ({ ...source, package: sharpPackages[0], declaredLicense: sharpNotice.declaredLicense }))
  ];
  // Validate the complete plan before copying anything. A changed version,
  // modified source or symlink must not result in a partially staged payload.
  const copyPlan = [];
  for (const source of applicableSources) {
    const entry = packages.get(source.package);
    if (!entry || entry.license !== source.declaredLicense) {
      throw new Error(`runtime package version or license changed: ${source.package}`);
    }
    const original = join(sourceRoot, source.filename);
    if (!lstatSync(original).isFile() || !realpathSync(original).startsWith(sourceRoot + sep)) {
      throw new Error(`upstream notice source is not a regular in-root file: ${source.filename}`);
    }
    const contents = readFileSync(original);
    if (digest(contents) !== source.sha256) {
      throw new Error(`upstream license source digest changed: ${source.filename}`);
    }
    const directories = new Set(entry.locations.map((location) => realpathSync(join(appRoot, location))));
    for (const directory of directories) {
      if (!directory.startsWith(appRoot + sep)) {
        throw new Error(`runtime package resolves outside application root: ${source.package}`);
      }
      const destination = join(directory, source.destination);
      let status;
      try {
        status = lstatSync(destination);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (status) {
        if (!status.isFile()) throw new Error(`existing runtime notice is not a regular file: ${source.package}`);
        if (digest(readFileSync(destination)) !== source.sha256) {
          throw new Error(`existing runtime notice differs: ${source.package}`);
        }
        continue;
      }
      copyPlan.push({ original, destination });
    }
  }
  for (const { original, destination } of copyPlan) copyFileSync(original, destination);
  return {
    packages: [...new Set(applicableSources.map((source) => source.package))],
    copiedFileCount: copyPlan.length,
    notices: applicableSources.map(({ package: name, destination, sha256 }) => ({
      package: name,
      filename: destination,
      sha256
    }))
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [root, sourceDirectory] = process.argv.slice(2);
    if (!root || !sourceDirectory) throw new Error('expected runtime and source directory paths');
    console.log(JSON.stringify(stageVersionedRuntimeNotices(root, sourceDirectory)));
  } catch (error) {
    console.error(`runtime notice staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
