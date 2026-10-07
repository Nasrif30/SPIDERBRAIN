import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');
for (const project of ['packages/shared', 'silk', 'synganglion', 'dashboard', 'deception', 'packages/sensor', 'packages/express', '.', 'apps/demo-site/tsconfig.server.json', 'apps/demo-site/tsconfig.client.json']) {
  const result = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
