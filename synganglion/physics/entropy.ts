export function entropy(values: readonly string[]): number {
  if (values.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) { const p = count / values.length; result -= p * Math.log2(p); }
  return result;
}
