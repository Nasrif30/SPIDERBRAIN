import type { Server } from 'node:http';

/** Try one preferred port, then let the OS select a free loopback port; no scan. */
export async function listenLocal(server: Server, preferred: number): Promise<number> {
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535) throw new Error('Invalid local port');
  async function attempt(port: number) {
    await new Promise<void>((resolve, reject) => {
      const error = (cause: Error) => { server.off('listening', ready); reject(cause); };
      const ready = () => { server.off('error', error); resolve(); };
      server.once('error', error); server.once('listening', ready); server.listen(port, '127.0.0.1');
    });
  }
  try { await attempt(preferred); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferred === 0) throw error;
    await attempt(0);
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local listener unavailable');
  return address.port;
}
export async function closeLocal(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
