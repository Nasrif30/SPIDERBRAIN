import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const destination = resolve(root, '.spiderbrain/npm-release');
await mkdir(destination, { recursive: true });
// A fresh generated runtime prevents assets from earlier packages leaking in.
const stagedRuntime = resolve(destination, 'dist');
if (dirname(stagedRuntime) !== destination) throw new Error('Invalid staged runtime directory');
await rm(stagedRuntime, { recursive: true, force: true });
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
delete pkg.workspaces; delete pkg.devDependencies;
// Installed packages do not need source build/dev scripts or workspace paths.
pkg.scripts = { start: 'node dist/public/cli.js start', monitor: 'node dist/public/cli.js monitor' };
await writeFile(resolve(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
await cp(resolve(root, 'dist/public'), resolve(destination, 'dist/public'), { recursive: true });
for (const file of ['LICENSE', 'CHANGELOG.md']) await cp(resolve(root, file), resolve(destination, file));
let readme = await readFile(resolve(root, 'README.md'), 'utf8');
readme = readme.replace(/\]\((?!https?:|mailto:)([^)#]+)(#[^)]*)?\)/g, (_all, path, fragment = '') => {
  const base = path.startsWith('docs/images/') ? 'https://raw.githubusercontent.com/Nasrif30/SPIDERBRAIN/main/' : 'https://github.com/Nasrif30/SPIDERBRAIN/blob/main/';
  return `](${base}${path}${fragment})`;
});
await writeFile(resolve(destination, 'README.md'), readme);
console.log('Clean npm release staged in .spiderbrain/npm-release. Publish GitHub documentation first so package image URLs resolve.');
