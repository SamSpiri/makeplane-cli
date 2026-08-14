let colorEnabled = true;

export function setColorEnabled(on: boolean): void {
  colorEnabled = on && !process.env.NO_COLOR;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

function ansi(code: number): string {
  return colorEnabled ? `\x1b[${code}m` : '';
}

function ansiReset(): string {
  return colorEnabled ? '\x1b[0m' : '';
}

export function red(s: string): string {
  return `${ansi(31)}${s}${ansiReset()}`;
}
export function green(s: string): string {
  return `${ansi(32)}${s}${ansiReset()}`;
}
export function yellow(s: string): string {
  return `${ansi(33)}${s}${ansiReset()}`;
}
export function cyan(s: string): string {
  return `${ansi(36)}${s}${ansiReset()}`;
}
export function dim(s: string): string {
  return `${ansi(2)}${s}${ansiReset()}`;
}
export function bold(s: string): string {
  return `${ansi(1)}${s}${ansiReset()}`;
}
export function italic(s: string): string {
  return `${ansi(3)}${s}${ansiReset()}`;
}
export function underline(s: string): string {
  return `${ansi(4)}${s}${ansiReset()}`;
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function die(msg: string): never {
  process.stderr.write(`${red('Error:')} ${msg}\n`);
  process.exit(1);
}
