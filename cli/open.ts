import { spawn } from 'node:child_process';

export function browserCommand(url: string, platform = process.platform): { command: string; args: string[] } {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Only generated local URLs can be opened');
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}
/** Launch the system default browser without reading any browser data. */
export async function openBrowser(url: string): Promise<boolean> {
  try {
    const { command, args } = browserCommand(url);
    return await new Promise<boolean>(resolve => {
      const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, shell: false });
      const timer = setTimeout(() => { child.unref(); resolve(false); }, 5000); timer.unref();
      child.once('error', () => { clearTimeout(timer); resolve(false); });
      child.once('exit', code => { clearTimeout(timer); resolve(code === 0); });
    });
  } catch { return false; }
}
