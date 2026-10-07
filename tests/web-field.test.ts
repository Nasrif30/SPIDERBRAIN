import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { script } from '@spiderbrain/live-web';

/** Executes the real renderer against inert drawing surfaces, not security models. */
function surface(reduced = false, mobile = false) {
  const handlers = new Map<string, (event: any) => void>(), frames = new Map<number, (time: number) => void>();
  let time = 0, next = 0;
  const draw: any = new Proxy({}, { get: (_target, key) => key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : key === 'measureText' ? (text: string) => ({ width: text.length * 7 }) : () => {} });
  const element = () => ({ className: '', width: 0, height: 0, textContent: '', append() {}, replaceChildren() {}, addEventListener() {}, getContext: (type: string) => type === '2d' ? draw : null });
  const document = { hidden: false, createElement: element, addEventListener: (name: string, fn: any) => handlers.set(name, fn), removeEventListener() {} };
  const motion = { matches: reduced, addEventListener() {} };
  const container = { dataset: {} as Record<string, string>, style: {}, append() {}, getBoundingClientRect: () => ({ width: 900, height: 600, left: 0, top: 0 }), addEventListener: (name: string, fn: any) => handlers.set(name, fn), setPointerCapture() {} };
  const fieldScript = script.slice(0, script.indexOf('const el='));
  assert.ok(fieldScript.length > 1000);
  const Field = runInNewContext(fieldScript + ';WebField', { document, window: { devicePixelRatio: 1, matchMedia: (query: string) => query.includes('reduced') ? motion : { matches: mobile }, addEventListener() {} }, ResizeObserver: class { observe() {} disconnect() {} }, performance: { now: () => time }, requestAnimationFrame: (fn: any) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id: number) => frames.delete(id) });
  const field = new Field(container, () => {}); field.resize();
  const tick = (value: number) => { time = value; const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(time); };
  const data = (count: number) => { const nodes = Array.from({ length: count }, (_, i) => ({ route: '/route-' + i, visits: 4, energy: i % 30, awareness: .2 })); return { graph: { nodes, edges: Array.from({ length: 250 }, (_, i) => ({ from: nodes[i % count]!.route, to: nodes[(i * 17 + 1) % count]!.route })) }, status: { energy: 30 }, canaries: [] }; };
  return { field, frames, handlers, document, motion, tick, data, container };
}

test('field handles 100 routes and 250 edges with bounded geometry and a fixed impulse pool', () => {
  const s = surface(), data = s.data(100), original = JSON.stringify(data);
  s.field.update(data);
  assert.equal(s.field.count, 800); assert.equal(s.field.nodes.length, 100);
  assert.equal(new Set(s.field.nodes.map((node: any) => node.vertex)).size, 100);
  assert.ok(s.field.edgeLength <= s.field.edgeLinks.length);
  for (const vertex of s.field.edgeLinks.slice(0, s.field.edgeLength)) assert.ok(vertex < 800);
  for (let i = 0; i < 100; i++) s.field.impulse({ route: '/route-' + i, from: '/route-' + ((i + 1) % 100), energy: 30 });
  assert.equal(s.field.impulses.length, 32); s.tick(16);
  for (let i = 2; i < s.field.vertices.length; i += 3) assert.ok(s.field.vertices[i] >= -.301 && s.field.vertices[i] <= .401);
  assert.equal(JSON.stringify(data), original, 'visual deformation never mutates telemetry');
  assert.ok(s.frames.size); s.tick(4000); assert.equal(s.frames.size, 0, 'expired waves stop RAF');
});

test('pause, hidden documents, reduced motion and mobile stop continuous animation', () => {
  for (const [reduced, mobile] of [[true, false], [false, true]]) {
    const s = surface(reduced, mobile); s.field.update(s.data(8)); s.field.impulse({ route: '/route-1', energy: 12 }); s.tick(16);
    assert.equal(s.frames.size, 0); assert.equal(s.container.dataset.motion, 'idle');
  }
  const s = surface(); s.field.update(s.data(8)); s.field.impulse({ route: '/route-1', energy: 12 }); s.tick(16);
  s.field.pause(true); s.tick(32); assert.equal(s.frames.size, 0);
  s.field.pause(false); s.document.hidden = true; s.handlers.get('visibilitychange')!({}); assert.equal(s.frames.size, 0);
});

test('orbit, right-button pan, bounded wheel zoom and reset operate independently of observations', () => {
  const s = surface(); s.field.update(s.data(8)); s.tick(16);
  const down = s.handlers.get('pointerdown')!, move = s.handlers.get('pointermove')!, up = s.handlers.get('pointerup')!;
  const pointer = (x: number, y: number, button: number) => ({ clientX: x, clientY: y, button, pointerId: 1, target: { closest: () => null } });
  down(pointer(100, 100, 0)); move(pointer(150, 110, 0)); up(pointer(150, 110, 0)); assert.ok(s.field.camera.yaw > -.22);
  down(pointer(100, 100, 2)); move(pointer(130, 120, 2)); up(pointer(130, 120, 2)); assert.ok(s.field.camera.panX > 0); assert.ok(s.field.camera.panY < 0);
  let prevented = false; s.handlers.get('wheel')!({ deltaY: -100000, preventDefault() { prevented = true; } }); assert.equal(s.field.camera.zoom, 3.5); assert.equal(prevented, true);
  s.field.reset(); assert.equal(s.field.camera.yaw, -.22); assert.equal(s.field.camera.panX, 0); assert.equal(s.field.camera.panY, 0);
});
