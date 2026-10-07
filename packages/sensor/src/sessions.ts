import { createHmac, randomBytes } from 'node:crypto';
/** No cookies, raw client keys, IP addresses or user agents are retained. */
export class AnonymousSessions {
  private key = randomBytes(32);
  private epoch: number | null = null;
  reset(): void { this.key = randomBytes(32); this.epoch = null; }
  id(clientKey: string, now: number): string {
    const epoch = Math.floor(now / 86_400_000);
    if (this.epoch !== epoch) { this.key = randomBytes(32); this.epoch = epoch; }
    return 'SB-' + createHmac('sha256', this.key).update(clientKey.slice(0, 512)).digest('hex').slice(0, 24);
  }
}
