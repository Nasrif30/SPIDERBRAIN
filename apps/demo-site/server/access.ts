import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import type { TransportHints } from '../shared/protocol.js';

const localNames = new Set(['localhost', '127.0.0.1', '[::1]']);
function authority(value: string | undefined) {
  if (!value || value.length > 260) return undefined;
  const match = /^(\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/.exec(value);
  if (!match) return undefined;
  const name = match[1]!.toLowerCase(), port = match[2] === undefined ? 80 : Number(match[2]);
  if (port < 1 || port > 65535) return undefined;
  return { name, port };
}
/** Only the website opts in. Proxy headers never authorize a request. */
export function demoAccess(headers: IncomingHttpHeaders, method: string, localHost: string, remoteDemo: boolean) {
  const host = authority(headers.host), local = authority(localHost);
  if (!host || !local) return { allowed: false, publicHost: false };
  const localRequest = localNames.has(host.name) && host.port === local.port;
  const publicHost = !localNames.has(host.name) && !isIP(host.name) && host.name.length <= 253 &&
    host.name.includes('.') && host.name.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  const allowedHost = localRequest || (remoteDemo && publicHost);
  // Quick Tunnel preserves the public Host while terminating HTTPS upstream.
  // Compare browser Origin with Host directly, not forwarded host/proto claims.
  const allowedOrigin = !headers.origin || headers.origin === `${localRequest ? 'http' : 'https'}://${headers.host}`;
  const navigation = ['GET', 'HEAD'].includes(method) && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document';
  const allowedFetch = headers['sec-fetch-site'] !== 'cross-site' || (remoteDemo && navigation);
  return { allowed: allowedHost && allowedOrigin && allowedFetch, publicHost: !localRequest && publicHost };
}

/** Unverified header-presence/type hints, never addresses or raw header values. */
export function transportHints(headers: IncomingHttpHeaders): TransportHints {
  const address = typeof headers['cf-connecting-ip'] === 'string' ? headers['cf-connecting-ip'] : headers['x-forwarded-for'];
  const candidate = typeof address === 'string' && address.length <= 1024 ? address.split(',')[0]!.trim() : '';
  const family = isIP(candidate), agent = typeof headers['user-agent'] === 'string' ? headers['user-agent'].slice(0, 1024) : '';
  return { cloudflarePresent: headers['cf-ray'] !== undefined || headers['cf-connecting-ip'] !== undefined,
    forwardedAddressClass: address === undefined ? 'absent' : family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : 'invalid',
    userAgentClass: !agent ? 'unknown' : /bot|crawler|spider|curl|wget|httpclient|python|node/i.test(agent) ? 'automation' : /mozilla|chrome|safari|firefox|edg\//i.test(agent) ? 'browser' : 'other' };
}
