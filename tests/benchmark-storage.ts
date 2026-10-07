import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import express from 'express';
import { Sensor } from '@spiderbrain/sensor';
import { spiderbrain } from '@spiderbrain/express';
const quantile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? 0;
const rounded = (n: number) => Math.round(n * 1000) / 1000;
function core(storage: 'none' | 'sqlite-memory' | 'sqlite-disk') {
  const directory = storage === 'sqlite-disk' ? mkdtempSync(join(tmpdir(), 'spiderbrain-storage-bench-')) : undefined;
  const sensor = new Sensor({ memory: storage === 'none' ? false : { path: directory ? join(directory, 'memory.sqlite') : ':memory:' } });
  const metadata = { clientKey: 'benchmark-client', path: '/about', method: 'GET', status: 200, latency: 1 };
  try {
    for (let i = 0; i < 500; i++) { sensor.observe(metadata); if (i % 128 === 127) sensor.memory?.flush(); }
    sensor.memory?.flush();
    const rounds: number[] = [], samples: number[] = [], batches: number[] = [];
    const flush = () => { if (sensor.memory) { const start = performance.now(); sensor.memory.flush(); batches.push(performance.now() - start); } };
    for (let round = 0; round < 5; round++) {
      const start = performance.now();
      for (let i = 0; i < 3000; i++) {
        const before = performance.now(); sensor.observe(metadata);
        if (i % 128 === 127) flush();
        samples.push((performance.now() - before) * 1000);
      }
      flush(); rounds.push((performance.now() - start) * 1000 / 3000);
    }
    const snapshot = sensor.liveWeb();
    return { storage, medianMicrosecondsPerObservation: rounded(quantile(rounds, 0.5)), p95MicrosecondsPerObservation: rounded(quantile(samples, 0.95)),
      eventsPerSecond: rounded(1_000_000 / quantile(rounds, 0.5)), droppedMemoryEvents: sensor.status().droppedMemoryEvents,
      routeGraphSize: { nodes: snapshot.graph.totalNodes, edges: snapshot.graph.totalEdges }, rounds,
      p95SqliteBatchMs: rounded(quantile(batches, 0.95)), maxSqliteBatchMs: rounded(Math.max(0, ...batches)) };
  } finally {
    sensor.close();
    if (directory) {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('spiderbrain-storage-bench-')) throw new Error('Unsafe cleanup target');
      rmSync(target, { recursive: true, force: true });
    }
  }
}
async function http(storage: 'sqlite-memory' | 'sqlite-disk') {
  const directory = storage === 'sqlite-disk' ? mkdtempSync(join(tmpdir(), 'spiderbrain-legacyRecord-http-')) : undefined;
  const sensor = new Sensor({ memory: { path: directory ? join(directory, 'memory.sqlite') : ':memory:' } });
  const baseline = express(), guarded = express(); guarded.use(spiderbrain(sensor));
  const paths = ['/', '/about', '/products', '/login', '/account'];
  for (const app of [baseline, guarded]) for (const path of paths) app.get(path, (_req, res) => res.send('ok'));
  const servers = [createServer(baseline), createServer(guarded)];
  const urls: string[] = [];
  for (const server of servers) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Benchmark listener unavailable');
    urls.push(`http://127.0.0.1:${address.port}`);
  }
  const duration = async (url: string) => { const start = performance.now(); const response = await fetch(url); await response.text(); return performance.now() - start; };
  const pairs: number[] = [], plain: number[] = [], protectedSamples: number[] = [], roundDifferences: number[] = [];
  try {
    for (let i = 0; i < 100; i++) for (const url of urls) await duration(url + paths[i % paths.length]!);
    for (let round = 0; round < 5; round++) {
      let baselineTime = 0, guardedTime = 0;
      for (let i = 0; i < 300; i++) {
        const path = paths[i % paths.length]!;
        let a: number, b: number;
        if (i % 2) { b = await duration(urls[1]! + path); a = await duration(urls[0]! + path); }
        else { a = await duration(urls[0]! + path); b = await duration(urls[1]! + path); }
        plain.push(a); protectedSamples.push(b); pairs.push(b - a); baselineTime += a; guardedTime += b;
      }
      roundDifferences.push((guardedTime - baselineTime) / 300);
    }
    sensor.memory!.flush(); const snapshot = sensor.liveWeb();
    return { medianOverheadMs: rounded(quantile(pairs, 0.5)), p95OverheadMs: rounded(quantile(pairs, 0.95)),
      medianRoundMeanOverheadMs: rounded(quantile(roundDifferences, 0.5)), baselineMedianMs: rounded(quantile(plain, 0.5)), guardedMedianMs: rounded(quantile(protectedSamples, 0.5)),
      guardedP95Ms: rounded(quantile(protectedSamples, 0.95)), eventsPerSecond: rounded(protectedSamples.length / (protectedSamples.reduce((a, b) => a + b, 0) / 1000)),
      requests: pairs.length, concurrency: 1, storage, droppedMemoryEvents: sensor.status().droppedMemoryEvents,
      routeGraphSize: { nodes: snapshot.graph.totalNodes, edges: snapshot.graph.totalEdges } };
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    sensor.close();
    if (directory) {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('spiderbrain-legacyRecord-http-')) throw new Error('Unsafe cleanup target');
      rmSync(target, { recursive: true, force: true });
    }
  }
}
function idle(): unknown {
  const result = spawnSync(process.execPath, ['--expose-gc', 'dist/tests/idle.js'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error('Idle sample failed'); return JSON.parse(result.stdout) as unknown;
}
function populatedMemory() {
  global.gc?.(); const before = process.memoryUsage();
  const routes = Array.from({ length: 256 }, (_, i) => '/route-' + i);
  const sensor = new Sensor({ memory: false, publicRoutes: routes });
  for (let step = 0; step < 4; step++) for (let i = 0; i < 1000; i++) sensor.observe({ clientKey: 'visitor-' + i,
    path: routes[(i * (step + 1) + step) % routes.length]!, method: 'GET', status: 200, latency: 1 });
  global.gc?.(); const after = process.memoryUsage(); const snapshot = sensor.liveWeb();
  const result = { sessions: sensor.status().sessions, graphNodes: snapshot.graph.totalNodes, graphEdges: snapshot.graph.totalEdges,
    processRssMiB: after.rss / 1024 / 1024, incrementalHeapMiB: (after.heapUsed - before.heapUsed) / 1024 / 1024,
    incrementalRssMiB: (after.rss - before.rss) / 1024 / 1024, note: '1000 sessions with four observations each, graph bounded at 256 nodes / 1024 edges; no SQLite in this footprint sample.' };
  sensor.close(); return result;
}
let historical: unknown = null;
try { historical = JSON.parse(readFileSync('.spiderbrain/basic-benchmark.json', 'utf8')); } catch { /* optional local baseline */ }
const report = { kind: 'engineering performance benchmark', node: process.version, platform: process.platform,
  core: core('none'), coreWithMemory: core('sqlite-memory'), coreWithDiskMemory: core('sqlite-disk'), http: await http('sqlite-memory'), httpWithDiskMemory: await http('sqlite-disk'),
  idle: idle(), populatedMemory: populatedMemory(), historicalBasicBenchmark: historical,
  note: 'Paired alternating local HTTP samples: p95 overhead is p95 of signed guarded-minus-baseline latency differences, including runtime/network scheduling noise. No watchers during timed samples. The earlier basic benchmark used round means and one route, so comparisons are approximate.' };
writeFileSync('benchmark-storage-results.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, historicalBasicBenchmark: historical ? 'saved in result file' : null }, null, 2));
