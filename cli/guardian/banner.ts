export const banner = String.raw`
                ███           ███
                █ █           █ █
               ████           ████
               ████           ████
               ████           █ ██
   ███         ████  ██████  ████        ████
   █ ████       █████████████████      ██████
   ████ ████    ██ █████████████   █████ ████
      █████████████   ████ █████████  ████
        █████    ██ ██  █ ██ ██    █████
           ████████ ███ █ ██ ████████
             ███████████   ████████
           ████ ██████    ██████ ████
        ██████████████████  ██████ █████
    ███ ███████ ██ █████████████ █████████
    ████████   ██████████ ███████   ████ █
    ████       ██████████████████      ███
              ██ ██ ████████ ██ ██
              ████    ████    ████
              ████            ████
              ████            ████
              ████            ███

             S P I D E R B R A I N
               SYNGANGLION ONLINE

        "The web remembers every vibration."
`;

export const attribution = '             made by Naskilabot';

export function terminalBanner(): string {
  return process.stdout.isTTY && process.env['NO_COLOR'] === undefined
    ? `\u001b[31m${banner}\u001b[0m`
    : banner;
}
