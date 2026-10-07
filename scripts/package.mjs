import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, relative, extname } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist/public');
await mkdir(output, { recursive: true });
for (const [entry, name] of [['dist/sdk/index.js', 'index'], ['dist/cli/release.js', 'cli']]) {
  await build({ entryPoints: [resolve(root, entry)], outfile: resolve(output, `${name}.js`), bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['express'], sourcemap: false, legalComments: 'none' });
}
// Remove only the previous generated demo asset directory, never source/data.
const demoOutput = resolve(root, 'dist/demo');
if (dirname(demoOutput) !== resolve(root, 'dist')) throw new Error('Invalid generated demo directory');
await rm(demoOutput, { recursive: true, force: true });
// Copy only reachable declarations and rewrite private workspace imports.
// The resulting package has no dependency on unpublished @spiderbrain packages.
const visited = new Set();
async function declarations(source) {
  const destination = resolve(output, 'types', relative(root, source));
  if (visited.has(source)) return destination;
  visited.add(source);
  let text = await readFile(source, 'utf8');
  const imports = [...text.matchAll(/(?:from\s+|import\()['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const specifier of new Set(imports)) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@spiderbrain/')) continue;
    const js = specifier.startsWith('.') ? resolve(dirname(source), specifier) : createRequire(source).resolve(specifier);
    const dependency = js.slice(0, -extname(js).length) + '.d.ts';
    const target = await declarations(dependency);
    let path = relative(dirname(destination), target).replaceAll('\\', '/').replace(/\.d\.ts$/, '.js');
    if (!path.startsWith('.')) path = './' + path;
    text = text.replaceAll(`'${specifier}'`, `'${path}'`).replaceAll(`"${specifier}"`, `"${path}"`);
  }
  await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, text);
  return destination;
}
const types = await declarations(resolve(root, 'dist/sdk/index.d.ts'));
await writeFile(resolve(output, 'index.d.ts'), `export * from './${relative(output, types).replaceAll('\\', '/').replace(/\.d\.ts$/, '.js')}';\n`);
console.log(`Public runtime built; ${visited.size} reachable declaration files. No tests, source maps or local data included.`);
