import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import express from 'express';
import { Sensor } from '@spiderbrain/sensor';
import { spiderbrain } from '@spiderbrain/express';
const metadata = { clientKey: 'benchmark-client', path: '/about', method: 'GET', status: 200, latency: 1 };
function core(storage: 'none' | 'sqlite-memory' | 'sqlite-disk') {
  const directory = storage === 'sqlite-disk' ? mkdtempSync(join(tmpdir(), 'spiderbrain-bench-')) : undefined;
  const sensor = new Sensor({ memory: storage === 'none' ? false : { path: directory ? join(directory, 'memory.sqlite') : ':memory:' } });
  for (let i = 0; i < 500; i++) {
    sensor.observe(metadata);
    if (i % 128 === 127) sensor.memory?.flush();
  }
  sensor.memory?.flush();
  const rounds: number[] = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < 3000; i++) {
      sensor.observe(metadata);
      // Include actual SQLite batches, while respecting the bounded queue.
      if (i % 128 === 127) sensor.memory?.flush();
    }
    sensor.memory?.flush();
    rounds.push((performance.now() - start) * 1000 / 3000);
  }
  const result = { medianMicrosecondsPerObservation: median(rounds), rounds, storage, droppedMemoryEvents: sensor.status().droppedMemoryEvents };
  sensor.close();
  if (directory) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('spiderbrain-bench-')) throw new Error('Unsafe cleanup target');
    rmSync(target, { recursive: true, force: true });
  }
  return result;
}
function median(numbers: number[]) { const ordered = [...numbers].sort((a, b) => a - b); return Math.round(ordered[Math.floor(ordered.length / 2)]! * 100) / 100; }
async function http() {
  const sensor = new Sensor({ memory: { path: ':memory:' } });
  const baseline = express(), protectedApp = express();
  protectedApp.use(spiderbrain(sensor));
  for (const app of [baseline, protectedApp]) app.get('/', (_req, res) => res.send('ok'));
  const servers = [createServer(baseline), createServer(protectedApp)];
  const urls: string[] = [];
  for (const server of servers) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Listener unavailable');
    urls.push(`http://127.0.0.1:${address.port}`);
  }
  const run = async (url: string, n: number) => {
    const start = performance.now();
    for (let i = 0; i < n; i++) { const response = await fetch(url); await response.text(); }
    return (performance.now() - start) / n;
  };
  try {
    for (const url of urls) await run(url, 100);
    const plain: number[] = [], guarded: number[] = [];
    // Alternate order to reduce warmup and drift bias.
    for (let i = 0; i < 5; i++) {
      if (i % 2) { guarded.push(await run(urls[1]!, 200)); plain.push(await run(urls[0]!, 200)); }
      else { plain.push(await run(urls[0]!, 200)); guarded.push(await run(urls[1]!, 200)); }
    }
    sensor.memory!.flush();
    return { baselineMillisecondsPerRequest: median(plain), guardedMillisecondsPerRequest: median(guarded),
      baselineRounds: plain, guardedRounds: guarded, droppedMemoryEvents: sensor.status().droppedMemoryEvents,
      requestsPerRound: 200, concurrency: 1 };
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    sensor.close();
  }
}
function idle(): unknown {
  const result = spawnSync(process.execPath, ['--expose-gc', 'dist/tests/idle.js'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('Idle benchmark failed');
  return JSON.parse(result.stdout) as unknown;
}
const result = { node: process.version, platform: process.platform, timestamp: new Date().toISOString(),
  core: core('none'), coreWithMemory: core('sqlite-memory'), coreWithDiskMemory: core('sqlite-disk'), http: await http(), idle: idle(),
  note: 'Local microbenchmark. Windows scheduling, loopback and fetch add noise; not a production capacity claim. Disk SQLite uses WAL with synchronous=NORMAL and the operating system cache.' };
writeFileSync('benchmark-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
