import type { PayloadPattern } from '@spiderbrain/sensor';
const fields = new Set(['q', 'query', 'search', 'id', 'path', 'file', 'filename', 'command', 'input', 'username']);
/** Bounded, ephemeral inspection of explicit demo input fields. Passwords,
 * tokens, private contact/profile contents and headers are never inspected. */
export function detectPayload(url: string, body: unknown): PayloadPattern[] {
  const values = [url.slice(0, 2048).split('?')[0]!];
  const query = new URLSearchParams(url.slice(0, 4096).split('?')[1] ?? '');
  let examined = 0;
  for (const [key, value] of query) { if (++examined > 16) break; if (fields.has(key)) values.push(value.slice(0, 1024)); }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const key of fields) { const descriptor = Object.getOwnPropertyDescriptor(body, key); if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') values.push(descriptor.value.slice(0, 1024)); }
  }
  const detected = new Set<PayloadPattern>();
  for (let value of values) {
    for (let i = 0; i < 2; i++) { try { const decoded = decodeURIComponent(value); if (decoded === value) break; value = decoded; } catch { break; } }
    if (/\bunion\s+(?:all\s+)?select\b|['"]\s*(?:or|and)\s+(?:\d{1,8}|['"][^'"]{0,24}['"])\s*=\s*(?:\d{1,8}|['"][^'"]{0,24}['"])|;\s*(?:drop|select|insert|update|delete)\b/i.test(value)) detected.add('sql_like');
    if (/<\s*(?:script|iframe)\b|\bon(?:error|load|click)\s*=|\bjavascript\s*:/i.test(value)) detected.add('script_like');
    if (/(?:^|[\/\\])\.\.[\/\\]/.test(value)) detected.add('path_traversal');
    if (/(?:;|&&|\|\||\|)\s*(?:whoami|id|cat|curl|wget|sh|bash|powershell|cmd)\b|\$\(\s*(?:whoami|id|cat|sh|bash)\b/i.test(value)) detected.add('shell_like');
  }
  return [...detected];
}
