import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function stripQuotePair(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
  }
  return v;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

export function parseDotEnvPlane(content: string): {
  vars: Record<string, string>;
  warnings: string[];
} {
  const vars: Record<string, string> = {};
  const warnings: string[] = [];

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      warnings.push(`Skipping malformed line: ${trimmed}`);
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    if (key === '') {
      warnings.push(`Skipping malformed line: ${trimmed}`);
      continue;
    }

    const rawValue = trimmed.slice(eqIdx + 1);
    const value = stripQuotePair(rawValue);
    vars[key] = value;
  }

  return { vars, warnings };
}

export function loadDotEnvFile(filePath: string): void {
  let data: string;
  try {
    data = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return;
    }
    return;
  }

  const { vars, warnings } = parseDotEnvPlane(data);

  for (const warning of warnings) {
    process.stderr.write(`${yellow(warning)}\n`);
  }

  for (const [key, value] of Object.entries(vars)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function getUserDotEnvPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.config', 'plane-cli', '.env');
}

export function loadDotEnvPlane(cwd: string): void {
  loadDotEnvFile(path.join(cwd, '.env.plane'));
}

export function loadUserDotEnvPlane(): void {
  loadDotEnvFile(getUserDotEnvPath());
}
