import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';
import { handleCycle } from '../commands/cycle.js';

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
    command: 'cycle',
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

describe('handleCycle', () => {
  describe('show', () => {
    it('prints cycle details and issues', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        description: 'Sprint goal: ship auth',
        start_date: '2024-01-01',
        end_date: '2024-01-14',
        status: 'started',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
        results: [
          {
            id: 'wi-1',
            sequence_id: 1,
            name: 'Login flow',
            priority: 'high',
            state: { name: 'In Progress', group: 'started' },
          },
          {
            id: 'wi-2',
            sequence_id: 2,
            name: 'Token refresh',
            priority: 'urgent',
            state: { name: 'Done', group: 'completed' },
          },
        ],
      });

      const out = await capturedOutput(() =>
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Sprint 24'],
          }),
          null,
        ),
      );

      expect(out).toContain('Sprint 24');
      expect(out).toContain('Status: started');
      expect(out).toContain('2024-01-01');
      expect(out).toContain('2024-01-14');
      expect(out).toContain('Sprint goal: ship auth');
      expect(out).toContain('ISSUES');
      expect(out).toContain('DEV-1');
      expect(out).toContain('DEV-2');
    });

    it('with --json returns structured data', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        status: 'started',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
        results: [],
      });

      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      try {
        await handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', json: true },
            positional: ['Sprint 24'],
          }),
          null,
        );
      } finally {
        process.stdout.write = original;
      }

      const parsed = JSON.parse(captured);
      expect(parsed.project).toBe('DEV');
      expect(parsed.cycle.name).toBe('Sprint 24');
      expect(Array.isArray(parsed.issues)).toBe(true);
    });

    it('with no name errors', async () => {
      const responses = baseResponses();

      await expect(
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: [],
          }),
          null,
        ),
      ).rejects.toThrow(/Usage: pl cycle show/);
    });

    it('with no project errors', async () => {
      const responses = baseResponses();

      await expect(
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            positional: ['Sprint 24'],
          }),
          null,
        ),
      ).rejects.toThrow(/No project specified/);
    });

    it('with --format html passes description through as raw HTML', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        description: '<p>raw <strong>HTML</strong></p>',
        status: 'started',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'html' },
            positional: ['Sprint 24'],
          }),
          null,
        ),
      );

      expect(out).toContain('<p>raw <strong>HTML</strong></p>');
    });

    it('with --format markdown renders description as CommonMark', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        description: '<p>line one</p><p>line <strong>two</strong></p>',
        status: 'started',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
        results: [],
      });

      const out = await capturedOutput(() =>
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'markdown' },
            positional: ['Sprint 24'],
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
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV', format: 'json' },
            positional: ['Sprint 24'],
          }),
          null,
        ),
      ).rejects.toThrow(/Invalid --format/);
    });

    it('counters come from the items list, not the detail endpoint', async () => {
      // Regression: Plane's cycle/module detail endpoint can return stale or
      // incorrect per-state counts. Trust the items list as source of truth.
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        status: 'started',
        total_issues: 6,
        completed_issues: 1,
        started_issues: 0,
        unstarted_issues: 0,
        backlog_issues: 0,
        cancelled_issues: 0,
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
        results: [
          ...Array.from({ length: 6 }, (_, i) => ({
            id: `wi-${i}`,
            sequence_id: 33 + i,
            name: `Task ${i + 1}`,
            priority: 'high',
            state: { name: 'Done', group: 'completed' },
          })),
        ],
      });

      const out = await capturedOutput(() =>
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Sprint 24'],
          }),
          null,
        ),
      );

      expect(out).toContain('total: 6');
      expect(out).toContain('completed: 6');
      expect(out).not.toContain('completed: 1');
    });

    it('counters always render in fixed order with zero buckets shown', async () => {
      // Policy: the stats line is always
      //   total, completed, started, unstarted, backlog, cancelled
      // in that order, with zero buckets rendered as `name: 0`. This keeps
      // output visually stable for users scanning multiple modules/cycles.
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/', {
        results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }],
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/', {
        id: 'c1',
        name: 'Sprint 24',
        status: 'started',
      });
      responses.set('/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/', {
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
        handleCycle(
          ctx(responses),
          mockArgs({
            subcommand: 'show',
            flags: { project: 'DEV' },
            positional: ['Sprint 24'],
          }),
          null,
        ),
      );

      const expected = 'total: 1  completed: 0  started: 0  unstarted: 0  backlog: 1  cancelled: 0';
      expect(out).toContain(expected);
    });
  });

  describe('auto-detect markdown in --body', () => {
    it('create with markdown body converts to HTML', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleCycle(
          ctx(baseResponses(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { project: 'DEV', title: 'Sprint 25', body: '## Goal\n\n[docs](https://x.com)' },
          }),
          null,
        ),
      );
      const description = (captured[0].body as Record<string, unknown>).description as string;
      expect(description).toContain('<h2>Goal</h2>');
      expect(description).toContain('<a href="https://x.com">docs</a>');
    });
  });
});
