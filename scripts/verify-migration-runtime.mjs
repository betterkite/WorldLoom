import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';

// Check the final image, including dangling launchers that existsSync overlooks.
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

assert.notEqual(process.getuid(), 0, 'migration must run as a non-root user');
for (const command of ['npm', 'npx', 'corepack', 'pnpm', 'pnpx', 'yarn', 'yarnpkg', 'docker-entrypoint.sh']) {
  assert(!present(`/usr/local/bin/${command}`), `unexpected build-time launcher: ${command}`);
}
if (present('/usr/local/lib/node_modules')) {
  assert.deepEqual(readdirSync('/usr/local/lib/node_modules'), [], 'unexpected global Node packages');
}
assert(!present('/opt') || !readdirSync('/opt').some((name) => /^yarn(?:-|$)/.test(name)), 'unexpected Yarn distribution');
assert(present('/app/node_modules/prisma/build/index.js'), 'Prisma migration entrypoint is missing');
assert(present('/nodejs/LICENSE'), 'Node license is missing');
const prisma = JSON.parse(readFileSync('/app/node_modules/prisma/package.json', 'utf8'));
assert.equal(prisma.version, '6.19.3', 'migration Prisma version changed; review the locked runtime');
console.log(JSON.stringify({ node: process.version, prisma: prisma.version, uid: process.getuid(), packageManagers: [] }));
