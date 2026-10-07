/** Fresh-process idle sample; avoids attributing benchmark garbage collection to idle work. */
global.gc?.();
const baseline = process.memoryUsage();
const { Sensor } = await import('@spiderbrain/sensor');
const sensor = new Sensor({ memory: { path: ':memory:' } });
global.gc?.();
await new Promise((resolve) => setTimeout(resolve, 500));
const guarded = process.memoryUsage();
const start = process.cpuUsage();
await new Promise((resolve) => setTimeout(resolve, 1000));
const used = process.cpuUsage(start);
sensor.close();
console.log(JSON.stringify({ processRssMiB: guarded.rss / 1024 / 1024,
  incrementalRssMiB: (guarded.rss - baseline.rss) / 1024 / 1024,
  incrementalHeapKiB: (guarded.heapUsed - baseline.heapUsed) / 1024,
  cpuMillisecondsIn1000ms: (used.user + used.system) / 1000,
  note: 'Fresh Node process with sensor and SQLite, no Express listener; one short idle sample.' }));
