import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseDotEnvPlane,
  loadDotEnvFile,
  loadDotEnvPlane,
  getUserDotEnvPath,
} from '../dotenv.js';

const savedEnv = { ...process.env };

function wipePlaneEnv(): void {
  delete process.env.PLANE_BASE_URL;
  delete process.env.PLANE_API_KEY;
  delete process.env.DEFAULT_WORKSPACE_SLUG;
  delete process.env.PLANE_DEFAULT_PROJECT;
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-test-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

describe('parseDotEnvPlane', () => {
  it('parses simple KEY=VALUE lines', () => {
    const { vars, warnings } = parseDotEnvPlane('KEY1=val1\nKEY2=val2\n');
    expect(vars).toEqual({ KEY1: 'val1', KEY2: 'val2' });
    expect(warnings).toEqual([]);
  });

  it('skips comments and blank lines', () => {
    const { vars, warnings } = parseDotEnvPlane('# comment\n\nKEY=val\n# another\n');
    expect(vars).toEqual({ KEY: 'val' });
    expect(warnings).toEqual([]);
  });

  it('trims whitespace around key', () => {
    const { vars } = parseDotEnvPlane('  KEY  =val\n');
    expect(vars).toEqual({ KEY: 'val' });
  });

  it('strips surrounding single and double quotes from values', () => {
    const { vars } = parseDotEnvPlane('A="hello"\nB=\'world\'\n');
    expect(vars).toEqual({ A: 'hello', B: 'world' });
  });

  it('warns on malformed lines', () => {
    const { vars, warnings } = parseDotEnvPlane('novalue\n=novalue\n');
    expect(vars).toEqual({});
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('novalue');
    expect(warnings[1]).toContain('=novalue');
  });
});

describe('loadDotEnvPlane (cwd .env.plane)', () => {
  beforeEach(() => {
    wipePlaneEnv();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('does nothing when .env.plane is missing', () => {
    withTempDir((dir) => {
      loadDotEnvPlane(dir);
      expect(process.env.PLANE_BASE_URL).toBeUndefined();
      expect(process.env.PLANE_API_KEY).toBeUndefined();
    });
  });

  it('loads variables from .env.plane', () => {
    withTempDir((dir) => {
      writeFile(path.join(dir, '.env.plane'), 'PLANE_BASE_URL=https://cwd.example.com\nPLANE_API_KEY=cwd-key\nDEFAULT_WORKSPACE_SLUG=cwd-ws\n');
      loadDotEnvPlane(dir);
      expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
      expect(process.env.PLANE_API_KEY).toBe('cwd-key');
      expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('cwd-ws');
    });
  });

  it('does not overwrite existing env vars (fill-missing-only)', () => {
    process.env.PLANE_API_KEY = 'shell-key';
    withTempDir((dir) => {
      writeFile(path.join(dir, '.env.plane'), 'PLANE_API_KEY=cwd-key\nPLANE_BASE_URL=https://cwd.example.com\n');
      loadDotEnvPlane(dir);
      expect(process.env.PLANE_API_KEY).toBe('shell-key');
      expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
    });
  });

  it('warns on malformed lines while loading valid lines', () => {
    const warn = vi.spyOn(process.stderr, 'write');
    withTempDir((dir) => {
      writeFile(path.join(dir, '.env.plane'), 'PLANE_BASE_URL=https://cwd.example.com\nbadline\nPLANE_API_KEY=cwd-key\n');
      loadDotEnvPlane(dir);
      expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
      expect(process.env.PLANE_API_KEY).toBe('cwd-key');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('badline'));
    });
    warn.mockRestore();
  });
});

describe('loadDotEnvFile with user-level path', () => {
  beforeEach(() => {
    wipePlaneEnv();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('does nothing when user-level file is missing', () => {
    withTempDir((home) => {
      const userPath = getUserDotEnvPath(home);
      loadDotEnvFile(userPath);
      expect(process.env.PLANE_BASE_URL).toBeUndefined();
      expect(process.env.PLANE_API_KEY).toBeUndefined();
    });
  });

  it('loads variables from user-level file', () => {
    withTempDir((home) => {
      const userPath = getUserDotEnvPath(home);
      writeFile(userPath, 'PLANE_BASE_URL=https://user.example.com\nPLANE_API_KEY=user-key\nDEFAULT_WORKSPACE_SLUG=user-ws\n');
      loadDotEnvFile(userPath);
      expect(process.env.PLANE_BASE_URL).toBe('https://user.example.com');
      expect(process.env.PLANE_API_KEY).toBe('user-key');
      expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('user-ws');
    });
  });

  it('fill-missing-only: does not overwrite existing env vars', () => {
    process.env.PLANE_API_KEY = 'shell-key';
    withTempDir((home) => {
      const userPath = getUserDotEnvPath(home);
      writeFile(userPath, 'PLANE_API_KEY=user-key\nPLANE_BASE_URL=https://user.example.com\n');
      loadDotEnvFile(userPath);
      expect(process.env.PLANE_API_KEY).toBe('shell-key');
      expect(process.env.PLANE_BASE_URL).toBe('https://user.example.com');
    });
  });

  it('warns on malformed lines while loading valid lines', () => {
    const warn = vi.spyOn(process.stderr, 'write');
    withTempDir((home) => {
      const userPath = getUserDotEnvPath(home);
      writeFile(userPath, 'PLANE_BASE_URL=https://user.example.com\nbadline\nPLANE_API_KEY=user-key\n');
      loadDotEnvFile(userPath);
      expect(process.env.PLANE_BASE_URL).toBe('https://user.example.com');
      expect(process.env.PLANE_API_KEY).toBe('user-key');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('badline'));
    });
    warn.mockRestore();
  });
});

describe('precedence: shell env > .env.plane > user file', () => {
  beforeEach(() => {
    wipePlaneEnv();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('.env.plane beats user file when shell env is absent', () => {
    withTempDir((home) => {
      withTempDir((cwd) => {
        // Correct loading order: cwd first (higher priority), user backfills
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_BASE_URL=https://cwd.example.com\nDEFAULT_WORKSPACE_SLUG=cwd-ws\n');
        loadDotEnvPlane(cwd);

        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'PLANE_BASE_URL=https://user.example.com\nPLANE_API_KEY=user-key\n');
        loadDotEnvFile(userPath);

        // cwd BASE_URL wins, user fills missing API_KEY only
        expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
        expect(process.env.PLANE_API_KEY).toBe('user-key');
        expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('cwd-ws');
      });
    });
  });

  it('user file backfills keys missing from cwd .env.plane', () => {
    withTempDir((home) => {
      withTempDir((cwd) => {
        // Load cwd file first (higher priority)
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_BASE_URL=https://cwd.example.com\n');
        loadDotEnvPlane(cwd);

        // Then load user file (backfill only)
        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'PLANE_BASE_URL=https://user.example.com\nPLANE_API_KEY=user-key\nDEFAULT_WORKSPACE_SLUG=user-ws\n');
        loadDotEnvFile(userPath);

        // cwd BASE_URL wins, user fills missing KEY and WS
        expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
        expect(process.env.PLANE_API_KEY).toBe('user-key');
        expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('user-ws');
      });
    });
  });

  it('shell env beats both files', () => {
    process.env.PLANE_API_KEY = 'shell-key';

    withTempDir((home) => {
      withTempDir((cwd) => {
        // Load cwd file first
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_API_KEY=cwd-key\nPLANE_BASE_URL=https://cwd.example.com\nDEFAULT_WORKSPACE_SLUG=cwd-ws\n');
        loadDotEnvPlane(cwd);

        // Then user file
        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'PLANE_API_KEY=user-key\nPLANE_BASE_URL=https://user.example.com\n');
        loadDotEnvFile(userPath);

        // Shell KEY wins, cwd BASE_URL wins (shell had no BASE_URL), cwd WS wins
        expect(process.env.PLANE_API_KEY).toBe('shell-key');
        expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
        expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('cwd-ws');
      });
    });
  });

  it('PLANE_DEFAULT_PROJECT follows the same precedence chain', () => {
    process.env.PLANE_DEFAULT_PROJECT = 'shell-proj';

    withTempDir((home) => {
      withTempDir((cwd) => {
        // cwd file sets DEFAULT_PROJECT (but shell already has it, so fill-missing skips)
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_DEFAULT_PROJECT=cwd-proj\n');
        loadDotEnvPlane(cwd);

        // user file also sets DEFAULT_PROJECT (skipped, shell has it)
        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'PLANE_DEFAULT_PROJECT=user-proj\n');
        loadDotEnvFile(userPath);

        expect(process.env.PLANE_DEFAULT_PROJECT).toBe('shell-proj');
      });
    });

    // Now without shell env: cwd beats user
    delete process.env.PLANE_DEFAULT_PROJECT;

    withTempDir((home) => {
      withTempDir((cwd) => {
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_DEFAULT_PROJECT=cwd-proj\n');
        loadDotEnvPlane(cwd);

        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'PLANE_DEFAULT_PROJECT=user-proj\n');
        loadDotEnvFile(userPath);

        expect(process.env.PLANE_DEFAULT_PROJECT).toBe('cwd-proj');
      });
    });
  });

  it('user file provides fallback when neither shell nor cwd file sets a key', () => {
    withTempDir((home) => {
      withTempDir((cwd) => {
        // cwd file has no DEFAULT_WORKSPACE_SLUG
        writeFile(path.join(cwd, '.env.plane'), 'PLANE_BASE_URL=https://cwd.example.com\n');
        loadDotEnvPlane(cwd);

        // user file provides DEFAULT_WORKSPACE_SLUG
        const userPath = getUserDotEnvPath(home);
        writeFile(userPath, 'DEFAULT_WORKSPACE_SLUG=user-ws\nPLANE_API_KEY=user-key\n');
        loadDotEnvFile(userPath);

        expect(process.env.PLANE_BASE_URL).toBe('https://cwd.example.com');
        expect(process.env.PLANE_API_KEY).toBe('user-key');
        expect(process.env.DEFAULT_WORKSPACE_SLUG).toBe('user-ws');
      });
    });
  });
});
