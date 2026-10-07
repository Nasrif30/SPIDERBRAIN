import type { ArenaScenario } from '../types.js';
export const noisyBot: ArenaScenario = { name: 'noisy-bot', expected: 'ordinary', steps:
  Array.from({ length: 100 }, (_, i) => ({ path: ['/', '/products', '/about', '/login', '/api/health'][i % 5]!, afterMs: 8 })) };
