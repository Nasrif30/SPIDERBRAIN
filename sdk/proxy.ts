import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { demoAccess, transportHints } from '../apps/demo-site/server/access.js';
import { detectPayload } from '../apps/demo-site/server/payload.js';
import { spiderbrain } from './index.js';
import { listenLocal, closeLocal } from './network.js';

export function validateTarget(value: string, allowRemote = false): URL {
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Use an HTTP(S) target URL without credentials, query or fragment');
  if (!allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('Remote targets require --allow-remote and authorization');
  return target;
}
function cleanHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const copy = { ...headers };
  const nominated = typeof headers.connection === 'string' ? headers.connection.toLowerCase().split(',').map(value => value.trim()) : [];
  for (const key of ['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', ...nominated]) delete copy[key];
  return copy;
}
/** Fixed-target streaming proxy. No interception, body buffering or TLS MITM. */
export async function startMonitor(value: string, options: { gatewayPort?: number; dashboardPort?: number; allowRemote?: boolean; memory?: false | string } = {}) {
  const target = validateTarget(value, options.allowRemote ?? false);
  const guardian = spiderbrain({ dashboard: true, dashboardPort: options.dashboardPort ?? 5173, memory: options.memory === false ? false : { path: options.memory ?? '.spiderbrain/web-memory.sqlite' }, publicRoutes: ['/api/ai/model-request', '/api/ai/model-response'] });
  let port = 0;
  const upstreams = new Set<ReturnType<typeof httpRequest>>();
  const server = createServer((req, res) => {
    if (!demoAccess(req.headers, req.method ?? 'GET', `127.0.0.1:${port}`, false).allowed) { res.writeHead(403); res.end('Local monitoring gateway only'); return; }
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end('Invalid request path'); return; }
    const started = performance.now(), path = req.url;
    res.once('finish', () => {
      guardian.collector.observe({ clientKey: req.socket.remoteAddress ?? 'unknown', path, method: req.method ?? 'GET', status: res.statusCode, latency: performance.now() - started, payload: detectPayload(path, undefined) }, transportHints(req.headers));
    });
    const headers = cleanHeaders(req.headers); headers.host = target.host;
    for (const name of Object.keys(headers)) if (/^(x-forwarded-|forwarded$|cf-)/.test(name)) delete headers[name];
    if (headers.origin === `http://${req.headers.host}`) headers.origin = target.origin;
    if (typeof headers.referer === 'string' && headers.referer.startsWith(`http://${req.headers.host}/`)) headers.referer = target.origin + headers.referer.slice(`http://${req.headers.host}`.length);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = send({ protocol: target.protocol, hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || undefined, method: req.method, path: target.pathname.replace(/\/$/, '') + path, headers }, incoming => {
      const responseHeaders = cleanHeaders(incoming.headers);
      if (typeof responseHeaders.location === 'string') {
        try { const location = new URL(responseHeaders.location, target); if (location.origin === target.origin) responseHeaders.location = location.pathname + location.search + location.hash; } catch { delete responseHeaders.location; }
      }
      res.writeHead(incoming.statusCode ?? 502, responseHeaders); incoming.pipe(res);
    });
    upstreams.add(upstream); upstream.once('close', () => upstreams.delete(upstream));
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('Target unavailable'); } else res.destroy(); });
    res.on('close', () => upstream.destroy()); req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
  });
  server.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\nWebSocket proxying is not supported.'); });
  server.headersTimeout = 10_000; server.requestTimeout = 60_000;
  try {
    port = await listenLocal(server, options.gatewayPort ?? 8787);
    const urls = await guardian.ready;
    return { guardian, targetUrl: target.href, siteUrl: `http://127.0.0.1:${port}`, ...urls, close: async () => { for (const upstream of upstreams) upstream.destroy(); await closeLocal(server); await guardian.close(); } };
  } catch (error) { await closeLocal(server); await guardian.close(); throw error; }
}
