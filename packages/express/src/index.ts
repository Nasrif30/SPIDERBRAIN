import { performance } from 'node:perf_hooks';
import type { RequestHandler, Response } from 'express';
import type { Sensor, AuthenticationMetadata, HoneyObservation } from '@spiderbrain/sensor';
export { createSensor, startTelemetry, createCanaryManifest } from '@spiderbrain/sensor';
export interface MiddlewareOptions { onError?: (message: string) => void }
const authOutcome = Symbol('spiderbrain.application-authentication-outcome');
const honeyOutcome = Symbol('spiderbrain.synthetic-response');
/** Install only after the observer, and only when the developer opts in on the sensor. */
export function canaryRoutes(sensor: Pick<Sensor, 'canaryResponse'>): RequestHandler {
  return (req, res, next) => {
    try {
      const response = sensor.canaryResponse(req.originalUrl, req.method);
      if (!response) { next(); return; }
      (res.locals as Record<symbol, HoneyObservation[]>)[honeyOutcome] = [response.honey];
      res.set({ 'Content-Type': response.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' });
      res.status(200).end(req.method === 'HEAD' ? undefined : response.body);
    } catch { if (!res.headersSent) next(); else res.end(); }
  };
}
/** Explicit outcome only; SpiderBrain does not inspect any login body or credential. */
export function noteAuthentication(res: Pick<Response, 'locals'>, event: AuthenticationMetadata): void {
  const locals = res.locals as Record<symbol, AuthenticationMetadata>;
  locals[authOutcome] = { type: event.type,
    ...(typeof event.identityKey === 'string' ? { identityKey: event.identityKey.slice(0, 512) } : {}),
    ...(typeof event.authenticated === 'boolean' ? { authenticated: event.authenticated } : {}) };
}
/** Observe only after response completion. No interception, body reads or blocking. */
export function spiderbrain(sensor: Pick<Sensor, 'observe'>, options: MiddlewareOptions = {}): RequestHandler {
  const report = () => { try { options.onError?.('SpiderBrain middleware failed; application continues'); } catch { /* fail open */ } };
  return (req, res, next) => {
    try {
      const start = performance.now();
      res.once('finish', () => {
        try {
          const template: unknown = req.route?.path;
          const locals = res.locals as Record<symbol, AuthenticationMetadata>;
          const authentication = locals[authOutcome];
          delete locals[authOutcome];
          const honeyLocals = res.locals as Record<symbol, HoneyObservation[]>;
          const honey = honeyLocals[honeyOutcome];
          delete honeyLocals[honeyOutcome];
          // Router mount may include parameter values. The sensor redacts both paths.
          sensor.observe({ clientKey: req.ip ?? req.socket.remoteAddress ?? 'unknown',
            path: req.originalUrl, ...(typeof template === 'string' ? { routeTemplate: req.baseUrl + template } : {}),
            method: req.method, status: res.statusCode, latency: performance.now() - start,
            ...(authentication ? { authentication } : {}), ...(honey ? { honey } : {}) });
        } catch { report(); }
      });
    } catch { report(); }
    next();
  };
}
