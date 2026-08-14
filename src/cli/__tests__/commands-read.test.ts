import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';
import { handleRead } from '../commands/read.js';

function mockClient(responses: Map<string, unknown>): PlaneClient {
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
    post: async () => ({}),
    patch: async () => ({}),
    delete: async () => ({}),
  } as unknown as PlaneClient;
}

function ctx(responses: Map<string, unknown>): ResolverContext {
  return new ResolverContext(mockClient(responses));
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
    command: 'list',
    subcommand: undefined,
    flags: {},
    positional: [] as string[],
    ...overrides,
  };
}

describe('handleRead', () => {
  it('list outputs work items', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        {
          results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }],
        },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            {
              id: 'wi1',
              sequence_id: 42,
              name: 'Fix bug',
              priority: 'high',
              state: { name: 'In Progress', group: 'started' },
            },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV' },
        }),
        null,
      ),
    );

    expect(out).toContain('DEV-42');
    expect(out).toContain('Fix bug');
    expect(out).toContain('P1');
  });

  it('projects lists all projects', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        {
          results: [
            { id: 'p1', identifier: 'DEV', name: 'Development' },
            { id: 'p2', identifier: 'OPS', name: 'Operations' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(ctx(responses), mockArgs({ command: 'projects' }), null),
    );

    expect(out).toContain('DEV');
    expect(out).toContain('Development');
    expect(out).toContain('OPS');
  });

  it('status outputs group summary', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        {
          results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }],
        },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            {
              id: 'wi1',
              sequence_id: 1,
              name: 'Task',
              priority: 'none',
              state: { name: 'Done', group: 'completed' },
            },
            {
              id: 'wi2',
              sequence_id: 2,
              name: 'Bug',
              priority: 'high',
              state: { name: 'In Progress', group: 'started' },
            },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'status',
          flags: { project: 'DEV' },
        }),
        null,
      ),
    );

    expect(out).toContain('started: 1');
    expect(out).toContain('completed: 1');
    expect(out).toContain('total: 2');
  });

  it('show resolves work item and prints details', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        {
          results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }],
        },
      ],
      [
        '/api/v1/workspaces/test-ws/issues/DEV-42/',
        {
          id: 'wi-uuid',
          project_id: 'p1',
          sequence_id: 42,
          name: 'Fix login',
          priority: 'urgent',
          state: { id: 's1', name: 'In Progress', group: 'started' },
          created_at: '2026-06-01',
          assignees: [],
          labels: [],
        },
      ],
      ['/api/v1/workspaces/test-ws/projects/p1/issues/wi-uuid/comments/', { results: [] }],
      ['/api/v1/workspaces/test-ws/projects/p1/issues/wi-uuid/relations/', { results: [] }],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'show',
          positional: ['DEV-42'],
        }),
        null,
      ),
    );

    expect(out).toContain('DEV-42');
    expect(out).toContain('Fix login');
    expect(out).toContain('P0');
  });

  it('list uses PLANE_DEFAULT_PROJECT when no --project', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        {
          results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }],
        },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            {
              id: 'wi1',
              sequence_id: 1,
              name: 'Task',
              priority: 'none',
              state: { name: 'Todo', group: 'unstarted' },
            },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(ctx(responses), mockArgs({ command: 'list' }), 'DEV'),
    );

    expect(out).toContain('DEV-1');
  });

  it('list --state filters client-side (API ignores state param)', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/states/',
        {
          results: [
            { id: 's-inprogress', name: 'In Progress', group: 'started' },
            { id: 's-todo', name: 'Todo', group: 'unstarted' },
          ],
        },
      ],
      // API returns ALL work items, ignoring any state filter it might receive.
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            {
              id: 'wi1',
              sequence_id: 1,
              name: 'In progress task',
              priority: 'high',
              state: { id: 's-inprogress', name: 'In Progress', group: 'started' },
            },
            {
              id: 'wi2',
              sequence_id: 2,
              name: 'Todo task',
              priority: 'low',
              state: { id: 's-todo', name: 'Todo', group: 'unstarted' },
            },
            {
              id: 'wi3',
              sequence_id: 3,
              name: 'Another in progress',
              priority: 'medium',
              state: { id: 's-inprogress', name: 'In Progress', group: 'started' },
            },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', state: 'In Progress' },
        }),
        null,
      ),
    );

    expect(out).toContain('DEV-1');
    expect(out).toContain('DEV-3');
    expect(out).not.toContain('DEV-2');
    expect(out).not.toContain('Todo task');
  });

  it('list --priority filters client-side', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            { id: 'wi1', sequence_id: 1, name: 'High one', priority: 'high' },
            { id: 'wi2', sequence_id: 2, name: 'Low one', priority: 'low' },
            { id: 'wi3', sequence_id: 3, name: 'High two', priority: 'high' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', priority: 'high' },
        }),
        null,
      ),
    );

    expect(out).toContain('High one');
    expect(out).toContain('High two');
    expect(out).not.toContain('Low one');
  });

  it('list --priority normalizes P-shorthand', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            { id: 'wi1', sequence_id: 1, name: 'Urgent item', priority: 'urgent' },
            { id: 'wi2', sequence_id: 2, name: 'Low item', priority: 'low' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', priority: 'P0' },
        }),
        null,
      ),
    );

    expect(out).toContain('Urgent item');
    expect(out).not.toContain('Low item');
  });

  it('list --label filters by resolved label id', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/labels/',
        {
          results: [{ id: 'l-backend', name: 'backend' }],
        },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            {
              id: 'wi1',
              sequence_id: 1,
              name: 'Backend task',
              priority: 'high',
              state: { id: 's1', name: 'Todo', group: 'unstarted' },
              labels: ['l-backend'],
            },
            {
              id: 'wi2',
              sequence_id: 2,
              name: 'Frontend task',
              priority: 'low',
              state: { id: 's1', name: 'Todo', group: 'unstarted' },
              labels: ['l-frontend'],
            },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', label: 'backend' },
        }),
        null,
      ),
    );

    expect(out).toContain('Backend task');
    expect(out).not.toContain('Frontend task');
  });

  it('list --cycle filters by cycle membership', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/cycles/',
        { results: [{ id: 'c1', name: 'Sprint 24' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/',
        { results: [{ id: 'wi1' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            { id: 'wi1', sequence_id: 1, name: 'In cycle', priority: 'high' },
            { id: 'wi2', sequence_id: 2, name: 'Not in cycle', priority: 'low' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', cycle: 'Sprint 24' },
        }),
        null,
      ),
    );

    expect(out).toContain('In cycle');
    expect(out).not.toContain('Not in cycle');
  });

  it('list --limit still slices the filtered result', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/issues/',
        {
          results: [
            { id: 'wi1', sequence_id: 1, name: 'High one', priority: 'high' },
            { id: 'wi2', sequence_id: 2, name: 'High two', priority: 'high' },
            { id: 'wi3', sequence_id: 3, name: 'High three', priority: 'high' },
            { id: 'wi4', sequence_id: 4, name: 'Low one', priority: 'low' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({
          command: 'list',
          flags: { project: 'DEV', priority: 'high', limit: '2' },
        }),
        null,
      ),
    );

    expect(out).toContain('High one');
    expect(out).toContain('High two');
    expect(out).not.toContain('High three');
    expect(out).not.toContain('Low one');
  });

  it('states lists project states in canonical group order', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/states/',
        {
          // Deliberately out-of-order to verify sorting.
          results: [
            { id: 's-done', name: 'Done', group: 'completed' },
            { id: 's-backlog', name: 'Backlog', group: 'backlog' },
            { id: 's-cancelled', name: 'Cancelled', group: 'cancelled' },
            { id: 's-progress', name: 'In Progress', group: 'started' },
            { id: 's-todo', name: 'Todo', group: 'unstarted' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({ command: 'states', flags: { project: 'DEV' } }),
        null,
      ),
    );

    const backlogIdx = out.indexOf('Backlog');
    const todoIdx = out.indexOf('Todo');
    const progressIdx = out.indexOf('In Progress');
    const doneIdx = out.indexOf('Done');
    const cancelledIdx = out.indexOf('Cancelled');

    expect(backlogIdx).toBeGreaterThan(-1);
    expect(todoIdx).toBeGreaterThan(backlogIdx);
    expect(progressIdx).toBeGreaterThan(todoIdx);
    expect(doneIdx).toBeGreaterThan(progressIdx);
    expect(cancelledIdx).toBeGreaterThan(doneIdx);
    expect(out).toContain('[backlog]');
    expect(out).toContain('[unstarted]');
  });

  it('states --json emits structured output', async () => {
    const responses = new Map([
      [
        '/api/v1/workspaces/test-ws/projects/',
        { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
      ],
      [
        '/api/v1/workspaces/test-ws/projects/p1/states/',
        {
          results: [
            { id: 's-todo', name: 'Todo', group: 'unstarted' },
            { id: 's-done', name: 'Done', group: 'completed' },
          ],
        },
      ],
    ]);

    const out = await capturedOutput(() =>
      handleRead(
        ctx(responses),
        mockArgs({ command: 'states', flags: { project: 'DEV', json: true } }),
        null,
      ),
    );

    const parsed = JSON.parse(out);
    expect(parsed.project).toBe('DEV');
    expect(Array.isArray(parsed.states)).toBe(true);
    expect(parsed.states).toHaveLength(2);
    expect(parsed.states[0].group).toBe('unstarted');
    expect(parsed.states[1].group).toBe('completed');
  });
});
