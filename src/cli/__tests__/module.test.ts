import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';
import { handleModule } from '../commands/module.js';

interface CapturedRequest {
  method: 'post' | 'patch' | 'delete';
  path: string;
  body: unknown;
}

function mockClient(
  responses: Map<string, unknown>,
  captured: CapturedRequest[] = [],
): PlaneClient {
  return {
    get: async (path: string, _qs?: Record<string, string>) => {
      if (responses.has(path)) return responses.get(path);
      for (const [k, v] of responses) {
        if (path === k) return v;
      }
      return { results: [] };
    },
    workspacePath: (subpath: string) => `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
    getWorkspaceSlug: () => 'test-ws',
    post: async (path: string, body: unknown) => {
      captured.push({ method: 'post', path, body });
      return { id: 'new-id', sequence_id: 99 };
    },
    patch: async (path: string, body: unknown) => {
      captured.push({ method: 'patch', path, body });
      return {};
    },
    delete: async (path: string) => {
      captured.push({ method: 'delete', path, body: undefined });
      return {};
    },
  } as unknown as PlaneClient;
}

function ctx(responses: Map<string, unknown>, captured: CapturedRequest[] = []): ResolverContext {
  return new ResolverContext(mockClient(responses, captured));
}

function capturedOutput(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const original = process.stdout.write;
    process.stdout.write = (chunk) => {
      out += String(chunk);
      return true;
    };
    fn()
      .then(() => {
        process.stdout.write = original;
        resolve(out);
      })
      .catch((err) => {
        process.stdout.write = original;
        reject(err);
      });
  });
}

function mockArgs(overrides: Record<string, unknown> = {}) {
  return {
    command: 'module',
    subcommand: undefined,
    flags: {},
    positional: [] as string[],
    ...overrides,
  };
}

const baseResponses = (): Map<string, unknown> =>
  new Map([
    [
      '/api/v1/workspaces/test-ws/projects/',
      {
        results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }],
      },
    ],
  ]);

describe('handleModule', () => {
  describe('show', () => {
    it('prints module details and issues', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        description: 'Authentication subsystem',
        start_date: '2024-01-01',
        target_date: '2024-02-01',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [
          {
            id: 'wi-1',
            sequence_id: 7,
            name: 'Login flow',
            priority: 'high',
            state: { name: 'In Progress', group: 'started' },
          },
        ],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      expect(out).toContain('Auth');
      expect(out).toContain('Status: in-progress');
      expect(out).toContain('2024-01-01');
      expect(out).toContain('2024-02-01');
      expect(out).toContain('Authentication subsystem');
      expect(out).toContain('ISSUES');
      expect(out).toContain('DEV-7');
    });

    it('with --json returns structured data', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [],
      });

      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      try {
        await handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', json: true },
            positional: ['Auth'],
          }),
          null,
        );
      } finally {
        process.stdout.write = original;
      }

      const parsed = JSON.parse(captured);
      expect(parsed.project).toBe('DEV');
      expect(parsed.module.name).toBe('Auth');
      expect(Array.isArray(parsed.issues)).toBe(true);
    });

    it('with no name errors', async () => {
      const responses = baseResponses();

      await expect(
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: [],
          }),
          null,
        ),
      ).rejects.toThrow(/Usage: pl module show/);
    });

    it('with no project errors', async () => {
      const responses = baseResponses();

      await expect(
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            positional: ['Auth'],
          }),
          null,
        ),
      ).rejects.toThrow(/No project specified/);
    });

    it('renders HTML description by default', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        description: '<p>line one</p><p>line <strong>two</strong></p>',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      expect(out).not.toContain('<p>');
      expect(out).not.toContain('<strong>');
      expect(out).toContain('line one');
      expect(out).toContain('two');
    });

    it('with --format html passes description through as raw HTML', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        description: '<p>raw <strong>HTML</strong></p>',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'html' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      expect(out).toContain('<p>raw <strong>HTML</strong></p>');
    });

    it('with --format markdown renders description as CommonMark', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        description: '<p>line one</p><p>line <strong>two</strong></p>',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'markdown' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      expect(out).not.toContain('<p>');
      expect(out).toContain('**two**');
    });

    it('with invalid --format errors out', async () => {
      const responses = baseResponses();

      await expect(
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'json' },
            positional: ['Auth'],
          }),
          null,
        ),
      ).rejects.toThrow(/Invalid --format/);
    });

    it('counters always render in fixed order with zero buckets shown', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [
          {
            id: 'wi-1',
            sequence_id: 1,
            name: 'only backlog',
            priority: 'none',
            state: { name: 'Backlog', group: 'backlog' },
          },
        ],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      const expected = 'total: 1  completed: 0  started: 0  unstarted: 0  backlog: 1  cancelled: 0';
      expect(out).toContain(expected);
    });

    it('empty membership renders all zero counters', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/', {
        results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/', {
        id: 'm1',
        name: 'Auth',
        status: 'in-progress',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleModule(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Auth'],
          }),
          null,
        ),
      );

      const expected = 'total: 0  completed: 0  started: 0  unstarted: 0  backlog: 0  cancelled: 0';
      expect(out).toContain(expected);
    });
  });

  describe('auto-detect markdown in --body', () => {
    it('create with markdown body converts to HTML', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleModule(
          ctx(baseResponses(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { project: 'DEV', title: 'Auth', body: '## Goal\n\n- one\n- two' },
          }),
          null,
        ),
      );
      const description = (captured[0].body as Record<string, unknown>).description as string;
      expect(description).toContain('<h2>Goal</h2>');
      expect(description).toContain('<li>one</li>');
    });
  });
});
