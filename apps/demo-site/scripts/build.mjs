import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const appRoot = fileURLToPath(new URL('../', import.meta.url));
function compile(args, cwd) {
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), ...args], { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
compile(['-b'], root);
const { build } = await import('vite');
await build({ root: appRoot, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) });
// Emit the watched server after assets are ready, so its cached HTML refers to
// the completed client build when Node restarts it.
compile(['-p', 'tsconfig.server.json'], appRoot);
await import('../../../scripts/package.mjs');
