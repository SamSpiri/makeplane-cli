import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';

function canonicalize(path: string, qs?: Record<string, string>): string {
  if (!qs || Object.keys(qs).length === 0) return path;
  const sorted = Object.entries(qs).sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${sorted.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

function makeClient(responses: Map<string, unknown>): PlaneClient {
  return {
    get: async (path: string, qs?: Record<string, string>) => {
      const canonical = canonicalize(path, qs);
      if (responses.has(canonical)) return responses.get(canonical);
      if (responses.has(path)) return responses.get(path);
      return { results: [] };
    },
    workspacePath: (subpath: string) => `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
    getWorkspaceSlug: () => 'test-ws',
    post: async () => ({}),
    patch: async () => ({}),
    delete: async () => ({}),
  } as unknown as PlaneClient;
}

describe('ResolverContext paginated item loaders', () => {
  it('loadCycleWorkItems walks all pages via cursor', async () => {
    // 3 pages of 2 items each = 6 items. Each page exposes a different cursor
    // and the final page reports no further results.
    const base = '/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/';
    const responses = new Map<string, unknown>([
      [
        `${base}?expand=state&per_page=100`,
        {
          count: 2,
          total_results: 6,
          next_cursor: 'c2',
          prev_cursor: 'c0',
          next_page_results: true,
          prev_page_results: false,
          results: [
            { id: 'wi-1', sequence_id: 1, name: 'a', state: { group: 'completed' } },
            { id: 'wi-2', sequence_id: 2, name: 'b', state: { group: 'started' } },
          ],
        },
      ],
      [
        `${base}?cursor=c2&expand=state&per_page=100`,
        {
          count: 2,
          total_results: 6,
          next_cursor: 'c3',
          prev_cursor: 'c1',
          next_page_results: true,
          prev_page_results: true,
          results: [
            { id: 'wi-3', sequence_id: 3, name: 'c', state: { group: 'completed' } },
            { id: 'wi-4', sequence_id: 4, name: 'd', state: { group: 'started' } },
          ],
        },
      ],
      [
        `${base}?cursor=c3&expand=state&per_page=100`,
        {
          count: 2,
          total_results: 6,
          next_cursor: '',
          prev_cursor: 'c2',
          next_page_results: false,
          prev_page_results: true,
          results: [
            { id: 'wi-5', sequence_id: 5, name: 'e', state: { group: 'unstarted' } },
            { id: 'wi-6', sequence_id: 6, name: 'f', state: { group: 'completed' } },
          ],
        },
      ],
    ]);

    const ctx = new ResolverContext(makeClient(responses));
    const items = await ctx.loadCycleWorkItems('p1', 'c1');

    expect(items).toHaveLength(6);
    expect(items[0].name).toBe('a');
    expect(items[5].name).toBe('f');
  });

  it('loadModuleWorkItems walks all pages via cursor', async () => {
    const base = '/api/v1/workspaces/test-ws/projects/p1/modules/m1/module-issues/';
    const responses = new Map<string, unknown>([
      [
        `${base}?expand=state&per_page=100`,
        {
          count: 2,
          total_results: 4,
          next_cursor: 'c2',
          prev_cursor: 'c0',
          next_page_results: true,
          prev_page_results: false,
          results: [
            { id: 'wi-1', sequence_id: 1, name: 'a', state: { group: 'completed' } },
            { id: 'wi-2', sequence_id: 2, name: 'b', state: { group: 'started' } },
          ],
        },
      ],
      [
        `${base}?cursor=c2&expand=state&per_page=100`,
        {
          count: 2,
          total_results: 4,
          next_cursor: '',
          prev_cursor: 'c1',
          next_page_results: false,
          prev_page_results: true,
          results: [
            { id: 'wi-3', sequence_id: 3, name: 'c', state: { group: 'completed' } },
            { id: 'wi-4', sequence_id: 4, name: 'd', state: { group: 'completed' } },
          ],
        },
      ],
    ]);

    const ctx = new ResolverContext(makeClient(responses));
    const items = await ctx.loadModuleWorkItems('p1', 'm1');

    expect(items).toHaveLength(4);
    expect(items[0].name).toBe('a');
    expect(items[3].name).toBe('d');
  });

  it('returns empty array when membership is empty', async () => {
    const base = '/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/';
    const responses = new Map<string, unknown>([
      [
        `${base}?expand=state&per_page=100`,
        {
          count: 0,
          total_results: 0,
          next_cursor: '',
          prev_cursor: '',
          next_page_results: false,
          prev_page_results: false,
          results: [],
        },
      ],
    ]);

    const ctx = new ResolverContext(makeClient(responses));
    const items = await ctx.loadCycleWorkItems('p1', 'c1');

    expect(items).toHaveLength(0);
  });

  it('stops when next_page_results is false even if next_cursor is set', async () => {
    // Some endpoints return a stale next_cursor but next_page_results=false.
    // We must trust the boolean, not the cursor string.
    const base = '/api/v1/workspaces/test-ws/projects/p1/cycles/c1/cycle-issues/';
    const responses = new Map<string, unknown>([
      [
        `${base}?expand=state&per_page=100`,
        {
          count: 1,
          total_results: 1,
          next_cursor: 'should-not-be-used',
          prev_cursor: '',
          next_page_results: false,
          prev_page_results: false,
          results: [{ id: 'wi-1', sequence_id: 1, name: 'only', state: { group: 'completed' } }],
        },
      ],
    ]);

    const ctx = new ResolverContext(makeClient(responses));
    const items = await ctx.loadCycleWorkItems('p1', 'c1');

    expect(items).toHaveLength(1);
  });
});
