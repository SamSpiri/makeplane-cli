import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';

function mockClient(responses: Map<string, unknown>): PlaneClient {
  return {
    get: async (path: string, _qs?: Record<string, string>) => {
      if (responses.has(path)) return responses.get(path);
      // Remove trailing query params if present, try exact match
      for (const [k, v] of responses) {
        if (path === k) return v;
      }
      return { results: [] };
    },
    workspacePath: (subpath: string) =>
      `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
    getWorkspaceSlug: () => 'test-ws',
    post: async () => ({ id: 'new-id', sequence_id: 99 }),
    patch: async () => ({}),
    delete: async () => ({}),
  } as unknown as PlaneClient;
}

function ctx(responses: Map<string, unknown>, defaultProject?: string | null): ResolverContext {
  return new ResolverContext(mockClient(responses), undefined, defaultProject);
}

describe('ResolverContext', () => {
  describe('resolveProject', () => {
    it('matches by exact identifier', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
                { id: 'p2', identifier: 'OPS', name: 'Operations' },
              ],
            },
          ],
        ]),
      );
      const p = await c.resolveProject('DEV');
      expect(p.id).toBe('p1');
      expect(p.identifier).toBe('DEV');
    });

    it('matches by exact name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
              ],
            },
          ],
        ]),
      );
      const p = await c.resolveProject('Development');
      expect(p.id).toBe('p1');
    });

    it('matches case-insensitive unique name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
              ],
            },
          ],
        ]),
      );
      const p = await c.resolveProject('development');
      expect(p.id).toBe('p1');
    });

    it('fails on ambiguity', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Dev' },
                { id: 'p2', identifier: 'DEV2', name: 'Dev' },
              ],
            },
          ],
        ]),
      );
      await expect(c.resolveProject('Dev')).rejects.toThrow('ambiguous');
    });

    it('fails when not found', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            { results: [{ id: 'p1', identifier: 'DEV', name: 'Dev' }] },
          ],
        ]),
      );
      await expect(c.resolveProject('NOPE')).rejects.toThrow(
        'No project matching',
      );
    });

    it('suggests a near-match typo', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
                { id: 'p2', identifier: 'LENGI', name: 'Localization' },
                { id: 'p3', identifier: 'OPS', name: 'Operations' },
              ],
            },
          ],
        ]),
      );
      await expect(c.resolveProject('LANGI')).rejects.toThrow(/Did you mean "LENGI"/);
    });

    it('does not suggest when no project is similar', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            { results: [{ id: 'p1', identifier: 'DEV', name: 'Dev' }] },
          ],
        ]),
      );
      await expect(c.resolveProject('XYZZY')).rejects.toThrow(/^No project matching/);
      await expect(c.resolveProject('XYZZY')).rejects.not.toThrow(/Did you mean/);
    });

    it('refetches from API when project is missing from stale cache', async () => {
      let diskProjects: unknown[] | null = [
        { id: 'p1', identifier: 'LENGI', name: 'Lengine' },
        { id: 'p2', identifier: 'MEM', name: 'vrajer' },
        { id: 'p3', identifier: 'DEV', name: 'dev' },
      ];
      let clearedSection: string | null = null;
      let savedSection: string | null = null;

      const fakeCache = {
        loadWorkspaceSection: async () => diskProjects,
        saveWorkspaceSection: async (_section: string, items: unknown[]) => {
          savedSection = _section;
          diskProjects = items;
        },
        clearWorkspaceSection: async (section: string) => {
          clearedSection = section;
          diskProjects = null;
        },
        loadProjectNamespace: async () => null,
        saveProjectNamespace: async () => {},
        mutateItem: async () => {},
        clear: async () => true,
        summary: async () => ({ baseDir: '', workspaceFile: null, projects: [] }),
      };

      const c = new ResolverContext(
        mockClient(
          new Map([
            [
              '/api/v1/workspaces/test-ws/projects/',
              {
                results: [
                  { id: 'p1', identifier: 'LENGI', name: 'Lengine' },
                  { id: 'p2', identifier: 'MEM', name: 'vrajer' },
                  { id: 'p3', identifier: 'DEV', name: 'dev' },
                  { id: 'p4', identifier: 'LANGI', name: 'Langi' },
                ],
              },
            ],
          ]),
        ),
        fakeCache as never,
      );

      const p = await c.resolveProject('LANGI');
      expect(p.identifier).toBe('LANGI');
      expect(p.id).toBe('p4');
      expect(clearedSection).toBe('projects');
      expect(savedSection).toBe('projects');
      expect((diskProjects as { identifier: string }[]).map((x) => x.identifier)).toContain(
        'LANGI',
      );
    });

    it('does not refetch when project is found in cache', async () => {
      let apiCalls = 0;
      const fakeCache = {
        loadWorkspaceSection: async () => [
          { id: 'p1', identifier: 'DEV', name: 'Development' },
        ],
        saveWorkspaceSection: async () => {},
        clearWorkspaceSection: async () => {},
        loadProjectNamespace: async () => null,
        saveProjectNamespace: async () => {},
        mutateItem: async () => {},
        clear: async () => true,
        summary: async () => ({ baseDir: '', workspaceFile: null, projects: [] }),
      };
      const client = {
        get: async () => {
          apiCalls++;
          return { results: [] };
        },
        workspacePath: (subpath: string) =>
          `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
        getWorkspaceSlug: () => 'test-ws',
        post: async () => ({}),
        patch: async () => ({}),
        delete: async () => ({}),
      } as unknown as PlaneClient;

      const c = new ResolverContext(client, fakeCache as never);
      const p = await c.resolveProject('DEV');
      expect(p.identifier).toBe('DEV');
      expect(apiCalls).toBe(0);
    });
  });

  describe('resolveWorkItem', () => {
    it('rejects invalid identifier format', async () => {
      const c = ctx(new Map());
      await expect(c.resolveWorkItem('not-an-id')).rejects.toThrow(
        'Invalid work item identifier',
      );
    });

    it('resolves PROJ-42', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
              ],
            },
          ],
          [
            '/api/v1/workspaces/test-ws/issues/DEV-42/',
            {
              id: 'wi-uuid',
              project_id: 'p1',
              sequence_id: 42,
              name: 'Test issue',
              priority: 'high',
              state: { id: 's1', name: 'In Progress', group: 'started' },
              assignees: [{ id: 'u1', display_name: 'Alice' }],
              labels: [{ id: 'l1', name: 'bug' }],
            },
          ],
        ]),
      );
      const wi = await c.resolveWorkItem('DEV-42');
      expect(wi.id).toBe('wi-uuid');
      expect(wi.sequence_id).toBe(42);
      expect(wi.identifier).toBe('DEV-42');
      expect(wi.priority).toBe('high');
      expect(wi.state?.name).toBe('In Progress');
      expect(wi.assigneeIds).toEqual(['u1']);
      expect(wi.labelIds).toEqual(['l1']);
    });

    it('resolves bare sequence number when default project is set', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/',
            {
              results: [
                { id: 'p1', identifier: 'DEV', name: 'Development' },
              ],
            },
          ],
          [
            '/api/v1/workspaces/test-ws/issues/DEV-7/',
            {
              id: 'wi-uuid',
              project_id: 'p1',
              sequence_id: 7,
              name: 'Bare number issue',
              priority: 'medium',
              state: { id: 's1', name: 'Backlog', group: 'backlog' },
              assignees: [],
              labels: [],
            },
          ],
        ]),
        'DEV',
      );
      const wi = await c.resolveWorkItem('7');
      expect(wi.id).toBe('wi-uuid');
      expect(wi.sequence_id).toBe(7);
      expect(wi.identifier).toBe('DEV-7');
    });

    it('rejects bare sequence number when no default project is set', async () => {
      const c = ctx(new Map());
      await expect(c.resolveWorkItem('7')).rejects.toThrow('Invalid work item identifier');
    });
  });

  describe('resolveState', () => {
    it('resolves by exact name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            {
              results: [
                { id: 's1', name: 'In Progress', group: 'started' },
                { id: 's2', name: 'Done', group: 'completed' },
              ],
            },
          ],
        ]),
      );
      const s = await c.resolveState('p1', 'In Progress');
      expect(s.id).toBe('s1');
    });

    it('fails on no match', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            { results: [{ id: 's1', name: 'Done', group: 'completed' }] },
          ],
        ]),
      );
      await expect(c.resolveState('p1', 'Missing')).rejects.toThrow(
        'No state named',
      );
    });
  });

  describe('resolveCompletedState', () => {
    it('returns unique completed state', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            {
              results: [
                { id: 's1', name: 'Done', group: 'completed' },
                { id: 's2', name: 'In Progress', group: 'started' },
              ],
            },
          ],
        ]),
      );
      const s = await c.resolveCompletedState('p1');
      expect(s.id).toBe('s1');
    });

    it('fails on multiple completed states', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            {
              results: [
                { id: 's1', name: 'Done', group: 'completed' },
                { id: 's2', name: 'Closed', group: 'completed' },
              ],
            },
          ],
        ]),
      );
      await expect(c.resolveCompletedState('p1')).rejects.toThrow(
        'Multiple completed',
      );
    });

    it('fails on no completed state', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            { results: [{ id: 's1', name: 'Todo', group: 'unstarted' }] },
          ],
        ]),
      );
      await expect(c.resolveCompletedState('p1')).rejects.toThrow(
        'No completed state',
      );
    });
  });

  describe('resolveUnstartedState', () => {
    it('prefers unstarted over backlog', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            {
              results: [
                { id: 's1', name: 'Backlog', group: 'backlog' },
                { id: 's2', name: 'Todo', group: 'unstarted' },
              ],
            },
          ],
        ]),
      );
      const s = await c.resolveUnstartedState('p1');
      expect(s.id).toBe('s2');
    });

    it('falls back to backlog', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            {
              results: [{ id: 's1', name: 'Backlog', group: 'backlog' }],
            },
          ],
        ]),
      );
      const s = await c.resolveUnstartedState('p1');
      expect(s.id).toBe('s1');
    });

    it('fails when none found', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/states/',
            { results: [{ id: 's1', name: 'Done', group: 'completed' }] },
          ],
        ]),
      );
      await expect(c.resolveUnstartedState('p1')).rejects.toThrow(
        'No unstarted or backlog',
      );
    });
  });

  describe('resolveMember', () => {
    it('matches by exact email', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/members/',
            {
              results: [
                {
                  id: 'u1',
                  email: 'alice@example.com',
                  display_name: 'Alice',
                },
                { id: 'u2', email: 'bob@example.com', display_name: 'Bob' },
              ],
            },
          ],
        ]),
      );
      const m = await c.resolveMember('alice@example.com');
      expect(m.id).toBe('u1');
    });

    it('matches by exact display name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/members/',
            {
              results: [
                { id: 'u1', email: 'a@x.com', display_name: 'Alice' },
              ],
            },
          ],
        ]),
      );
      const m = await c.resolveMember('Alice');
      expect(m.id).toBe('u1');
    });

    it('fails on ambiguous display name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/members/',
            {
              results: [
                { id: 'u1', email: 'a@x.com', display_name: 'Alex' },
                { id: 'u2', email: 'b@x.com', display_name: 'Alex' },
              ],
            },
          ],
        ]),
      );
      await expect(c.resolveMember('alex')).rejects.toThrow('ambiguous');
    });
  });

  describe('matchByName helper', () => {
    it('matches label by exact name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/labels/',
            {
              results: [
                { id: 'l1', name: 'backend' },
                { id: 'l2', name: 'frontend' },
              ],
            },
          ],
        ]),
      );
      const l = await c.resolveLabel('p1', 'backend');
      expect(l.id).toBe('l1');
    });
  });

  describe('cycle and module resolution', () => {
    it('resolves cycle by name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/cycles/',
            {
              results: [
                { id: 'c1', name: 'Sprint 24' },
              ],
            },
          ],
        ]),
      );
      const cy = await c.resolveCycle('p1', 'Sprint 24');
      expect(cy.id).toBe('c1');
    });

    it('resolves module by name', async () => {
      const c = ctx(
        new Map([
          [
            '/api/v1/workspaces/test-ws/projects/p1/modules/',
            {
              results: [
                { id: 'm1', name: 'Auth' },
              ],
            },
          ],
        ]),
      );
      const mod = await c.resolveModule('p1', 'Auth');
      expect(mod.id).toBe('m1');
    });
  });

  describe('debug logging on cache hits', () => {
    function debugClient(responses: Map<string, unknown>, _capture: { lines: string[] }) {
      return {
        get: async (path: string, _qs?: Record<string, string>) => {
          if (responses.has(path)) return responses.get(path);
          for (const [k, v] of responses) if (path === k) return v;
          return { results: [] };
        },
        workspacePath: (subpath: string) =>
          `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
        get debug() {
          return true;
        },
        post: async () => ({}),
        patch: async () => ({}),
        delete: async () => ({}),
      } as unknown as PlaneClient;
    }

    it('logs cache hit when projects are served from cache', async () => {
      const capture = { lines: [] as string[] };
      const origWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array): boolean => {
        if (typeof chunk === 'string') capture.lines.push(chunk);
        return true;
      }) as typeof process.stderr.write;
      try {
        const c = new ResolverContext(
          debugClient(new Map(), capture),
          {
            loadWorkspaceSection: async () => [
              { id: 'p1', identifier: 'DEV', name: 'Development' },
            ],
            saveWorkspaceSection: async () => {},
            loadProjectNamespace: async () => null,
            saveProjectNamespace: async () => {},
            mutateItem: async () => {},
            clear: async () => true,
            summary: async () => ({ baseDir: '', workspaceFile: null, projects: [] }),
          } as never,
        );
        await c.resolveProject('NOPE');
      } catch {
        /* expected to throw */
      } finally {
        process.stderr.write = origWrite;
      }
      expect(capture.lines.some((l) => l.includes('cache hit: projects'))).toBe(true);
    });
  });

  // Cycles and modules must never hit the disk cache: they churn too often
  // (sprint starts/ends, modules open/close) and stale data misleads more than
  // it helps. These tests pin that contract so a well-intentioned refactor
  // doesn't quietly re-introduce caching.
  describe('cycles and modules are not cached on disk', () => {
    function trackingCache() {
      const loadCalls: string[] = [];
      const saveCalls: string[] = [];
      const clearCalls: string[] = [];
      return {
        loadCalls,
        saveCalls,
        clearCalls,
        cache: {
          loadWorkspaceSection: async () => null,
          saveWorkspaceSection: async () => {},
          loadProjectNamespace: async <T>(_projectId: string, ns: string) => {
            loadCalls.push(ns);
            if (ns === 'cycles' || ns === 'modules') {
              return [
                { id: 'stale', name: 'STALE-FROM-CACHE' },
              ] as unknown as T;
            }
            return null;
          },
          saveProjectNamespace: async (_projectId: string, ns: string) => {
            saveCalls.push(ns);
          },
          mutateItem: async () => {},
          clear: async (_ns?: string) => {
            clearCalls.push(_ns ?? '*');
            return true;
          },
          summary: async () => ({ baseDir: '', workspaceFile: null, projects: [] }),
        } as never,
      };
    }

    it('loadCycles fetches from the API and ignores the cache', async () => {
      const track = trackingCache();
      const c = new ResolverContext(
        mockClient(
          new Map([
            [
              '/api/v1/workspaces/test-ws/projects/p1/cycles/',
              { results: [{ id: 'c1', name: 'Sprint 24', status: 'started' }] },
            ],
          ]),
        ),
        track.cache,
      );
      const cycles = await c.loadCycles('p1');
      expect(cycles.map((x) => x.name)).toEqual(['Sprint 24']);
      expect(track.loadCalls).not.toContain('cycles');
      expect(track.saveCalls).not.toContain('cycles');
    });

    it('loadModules fetches from the API and ignores the cache', async () => {
      const track = trackingCache();
      const c = new ResolverContext(
        mockClient(
          new Map([
            [
              '/api/v1/workspaces/test-ws/projects/p1/modules/',
              { results: [{ id: 'm1', name: 'Auth', status: 'in-progress' }] },
            ],
          ]),
        ),
        track.cache,
      );
      const modules = await c.loadModules('p1');
      expect(modules.map((x) => x.name)).toEqual(['Auth']);
      expect(track.loadCalls).not.toContain('modules');
      expect(track.saveCalls).not.toContain('modules');
    });

    it('invalidateCycles and invalidateModules do not touch the cache', async () => {
      const track = trackingCache();
      const c = new ResolverContext(mockClient(new Map()), track.cache);
      c.invalidateCycles('p1');
      c.invalidateModules('p1');
      expect(track.clearCalls).toEqual([]);
    });
  });
});
