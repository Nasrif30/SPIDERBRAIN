import { clamp } from '@spiderbrain/shared';
export interface DiffusionOptions { depth?: number; attenuation?: number; decay?: number; maxContribution?: number; maxRecipients?: number }
export interface DiffusionConfig { depth: number; attenuation: number; decay: number; maxContribution: number; maxRecipients: number }
export function diffusionConfig(options: DiffusionOptions = {}): DiffusionConfig {
  const config = { depth: options.depth ?? 1, attenuation: options.attenuation ?? 0.2, decay: options.decay ?? 0.1,
    maxContribution: options.maxContribution ?? 2, maxRecipients: options.maxRecipients ?? 32 };
  if (!Number.isInteger(config.depth) || config.depth < 0 || config.depth > 3 ||
    !Number.isInteger(config.maxRecipients) || config.maxRecipients < 1 || config.maxRecipients > 64 ||
    !Number.isFinite(config.attenuation) || config.attenuation < 0 || config.attenuation > 0.25 ||
    !Number.isFinite(config.decay) || config.decay < 0.05 || config.decay > 1 ||
    !Number.isFinite(config.maxContribution) || config.maxContribution < 0 || config.maxContribution > 2) throw new Error('Invalid diffusion bounds');
  return config;
}
/** Fresh impulses only. Breadth-first, deterministic, one visit per node, total budget <= 2. */
export function diffuse(source: string, impulse: number, neighbors: (route: string) => readonly string[], options: DiffusionOptions = {}): Map<string, number> {
  const config = diffusionConfig(options);
  const result = new Map<string, number>();
  if (config.depth === 0 || impulse < 3) return result;
  const visited = new Set([source]);
  let frontier = [{ route: source, energy: clamp(impulse, 0, 12) }];
  let remaining = config.maxContribution;
  for (let depth = 0; depth < config.depth && remaining > 0; depth++) {
    const next: typeof frontier = [];
    for (const item of frontier) {
      const adjacent = [...new Set(neighbors(item.route))].sort().filter((route) => !visited.has(route));
      const portion = adjacent.length ? item.energy * config.attenuation / adjacent.length : 0;
      for (const route of adjacent) {
        if (result.size >= config.maxRecipients || remaining <= 0) break;
        visited.add(route);
        const amount = Math.min(portion, remaining);
        if (amount <= 0) continue;
        result.set(route, amount);
        remaining = Math.max(0, remaining - amount);
        next.push({ route, energy: amount });
      }
    }
    frontier = next;
  }
  return result;
}
