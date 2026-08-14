import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';
import { handleProject } from '../commands/project.js';

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
      return { results: [] };
    },
    workspacePath: (subpath: string) => `/api/v1/workspaces/test-ws/${subpath.replace(/^\//, '')}`,
    getWorkspaceSlug: () => 'test-ws',
    post: async (path: string, body: unknown) => {
      captured.push({ method: 'post', path, body });
      return { id: 'new-uuid', name: 'Created', identifier: 'NEW' };
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
    command: 'project',
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
        results: [
          { id: 'p1', identifier: 'DEV', name: 'Development' },
          { id: 'p2', identifier: 'NEW', name: 'New Project' },
        ],
      },
    ],
  ]);

describe('handleProject', () => {
  describe('list', () => {
    it('prints project list (alias for pl projects)', async () => {
      const responses = baseResponses();
      const out = await capturedOutput(() =>
        handleProject(ctx(responses), mockArgs({ subcommand: 'list' }), null),
      );
      expect(out).toContain('DEV');
      expect(out).toContain('Development');
      expect(out).toContain('NEW');
    });

    it('with --json returns array of projects', async () => {
      const responses = baseResponses();
      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      try {
        await handleProject(
          ctx(responses),
          mockArgs({ subcommand: 'list', flags: { json: true } }),
          null,
        );
      } finally {
        process.stdout.write = original;
      }
      const parsed = JSON.parse(captured);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].identifier).toBe('DEV');
    });

    it('renders empty message when no projects', async () => {
      const responses = new Map<string, unknown>([
        ['/api/v1/workspaces/test-ws/projects/', { results: [] }],
      ]);
      const out = await capturedOutput(() =>
        handleProject(ctx(responses), mockArgs({ subcommand: 'list' }), null),
      );
      expect(out).toContain('no projects');
    });
  });

  describe('show', () => {
    it('prints project details', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/', {
        id: 'p1',
        identifier: 'DEV',
        name: 'Development',
        description: 'Engineering work',
        network: 2,
        project_lead: { display_name: 'Alice', email: 'alice@example.com' },
        total_members: 5,
        total_cycles: 3,
        total_modules: 2,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-06-01T00:00:00Z',
      });
      const out = await capturedOutput(() =>
        handleProject(ctx(responses), mockArgs({ subcommand: 'show', positional: ['DEV'] }), null),
      );
      expect(out).toContain('DEV');
      expect(out).toContain('Development');
      expect(out).toContain('public');
      expect(out).toContain('Alice');
      expect(out).toContain('members: 5');
      expect(out).toContain('cycles: 3');
      expect(out).toContain('modules: 2');
      expect(out).toContain('Engineering work');
    });

    it('with --json returns structured data', async () => {
      const responses = baseResponses();
      responses.set('/api/v1/workspaces/test-ws/projects/p1/', {
        id: 'p1',
        identifier: 'DEV',
        name: 'Development',
        network: 2,
      });
      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      try {
        await handleProject(
          ctx(responses),
          mockArgs({ subcommand: 'show', flags: { json: true }, positional: ['DEV'] }),
          null,
        );
      } finally {
        process.stdout.write = original;
      }
      const parsed = JSON.parse(captured);
      expect(parsed.project.identifier).toBe('DEV');
      expect(parsed.project.name).toBe('Development');
    });

    it('with no project errors', async () => {
      const responses = baseResponses();
      await expect(
        handleProject(ctx(responses), mockArgs({ subcommand: 'show' }), null),
      ).rejects.toThrow(/Usage: pl project show/);
    });
  });

  describe('create', () => {
    it('POSTs project to /projects/ with name and identifier', async () => {
      const responses = new Map<string, unknown>();
      const captured: CapturedRequest[] = [];
      const out = await capturedOutput(() =>
        handleProject(
          ctx(responses, captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'My Project', identifier: 'new' },
          }),
          null,
        ),
      );
      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe('post');
      expect(captured[0].path).toBe('/api/v1/workspaces/test-ws/projects/');
      expect(captured[0].body).toEqual({ name: 'My Project', identifier: 'NEW' });
      expect(out).toContain('NEW');
      expect(out).toContain('Created project');
    });

    it('lowercase identifier is auto-uppercased', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(new Map(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'foo' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).identifier).toBe('FOO');
    });

    it('with --body includes description', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(new Map(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', body: 'hello' },
          }),
          null,
        ),
      );
      expect(captured[0].body).toEqual({
        name: 'Foo',
        identifier: 'FOO',
        description: '<p>hello</p>',
      });
    });

    it('with --network public sets network=2', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(new Map(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', network: 'public' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).network).toBe(2);
    });

    it('with --network secret sets network=0', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(new Map(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', network: 'secret' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).network).toBe(0);
    });

    it('with --lead resolves member and sets project_lead', async () => {
      const responses = new Map<string, unknown>([
        [
          '/api/v1/workspaces/test-ws/members/',
          { results: [{ id: 'm-1', email: 'alice@example.com', display_name: 'Alice' }] },
        ],
      ]);
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(responses, captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', lead: 'alice@example.com' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).project_lead).toBe('m-1');
    });

    it('with --default-assignee resolves and sets default_assignee', async () => {
      const responses = new Map<string, unknown>([
        [
          '/api/v1/workspaces/test-ws/members/',
          { results: [{ id: 'm-2', email: 'bob@example.com', display_name: 'Bob' }] },
        ],
      ]);
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(responses, captured),
          mockArgs({
            subcommand: 'create',
            flags: {
              name: 'Foo',
              identifier: 'FOO',
              'default-assignee': 'bob@example.com',
            },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).default_assignee).toBe('m-2');
    });

    it('with --json returns structured output', async () => {
      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      try {
        await handleProject(
          ctx(new Map()),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', json: true },
          }),
          null,
        );
      } finally {
        process.stdout.write = original;
      }
      const parsed = JSON.parse(captured);
      expect(parsed.identifier).toBe('NEW');
      expect(parsed.id).toBe('new-uuid');
    });

    it('without --name errors', async () => {
      await expect(
        handleProject(
          ctx(new Map()),
          mockArgs({ subcommand: 'create', flags: { identifier: 'FOO' } }),
          null,
        ),
      ).rejects.toThrow(/--name is required/);
    });

    it('without --identifier errors', async () => {
      await expect(
        handleProject(
          ctx(new Map()),
          mockArgs({ subcommand: 'create', flags: { name: 'Foo' } }),
          null,
        ),
      ).rejects.toThrow(/--identifier is required/);
    });

    it('with invalid identifier format errors', async () => {
      await expect(
        handleProject(
          ctx(new Map()),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'toolong' },
          }),
          null,
        ),
      ).rejects.toThrow(/Invalid project identifier/);
    });

    it('with invalid --network errors', async () => {
      await expect(
        handleProject(
          ctx(new Map()),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', network: 'private' },
          }),
          null,
        ),
      ).rejects.toThrow(/Invalid --network/);
    });
  });

  describe('update', () => {
    it('PATCHes project with name', async () => {
      const responses = baseResponses();
      const captured: CapturedRequest[] = [];
      const out = await capturedOutput(() =>
        handleProject(
          ctx(responses, captured),
          mockArgs({
            subcommand: 'update',
            positional: ['DEV'],
            flags: { name: 'Dev Reloaded' },
          }),
          null,
        ),
      );
      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe('patch');
      expect(captured[0].path).toBe('/api/v1/workspaces/test-ws/projects/p1/');
      expect(captured[0].body).toEqual({ name: 'Dev Reloaded' });
      expect(out).toContain('DEV');
      expect(out).toContain('Updated');
    });

    it('identifier is auto-uppercased on update', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(baseResponses(), captured),
          mockArgs({
            subcommand: 'update',
            positional: ['DEV'],
            flags: { identifier: 'neww' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).identifier).toBe('NEWW');
    });

    it('with --lead resolves and sets', async () => {
      const responses = new Map<string, unknown>([
        [
          '/api/v1/workspaces/test-ws/projects/',
          { results: [{ id: 'p1', identifier: 'DEV', name: 'Development' }] },
        ],
        [
          '/api/v1/workspaces/test-ws/members/',
          { results: [{ id: 'm-1', email: 'a@b.com', display_name: 'A' }] },
        ],
      ]);
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(responses, captured),
          mockArgs({
            subcommand: 'update',
            positional: ['DEV'],
            flags: { lead: 'a@b.com' },
          }),
          null,
        ),
      );
      expect((captured[0].body as Record<string, unknown>).project_lead).toBe('m-1');
    });

    it('with no flags errors', async () => {
      const responses = baseResponses();
      await expect(
        handleProject(
          ctx(responses),
          mockArgs({ subcommand: 'update', positional: ['DEV'] }),
          null,
        ),
      ).rejects.toThrow(/No changes specified/);
    });

    it('with no project errors', async () => {
      await expect(
        handleProject(ctx(baseResponses()), mockArgs({ subcommand: 'update' }), null),
      ).rejects.toThrow(/Usage: pl project update/);
    });
  });

  describe('delete', () => {
    it('DELETEs project and prints confirmation', async () => {
      const responses = baseResponses();
      const captured: CapturedRequest[] = [];

      // Capture both stdout and stderr
      let stdout = '';
      let stderr = '';
      const origOut = process.stdout.write;
      const origErr = process.stderr.write;
      process.stdout.write = (chunk) => {
        stdout += String(chunk);
        return true;
      };
      process.stderr.write = (chunk) => {
        stderr += String(chunk);
        return true;
      };
      try {
        await handleProject(
          ctx(responses, captured),
          mockArgs({ subcommand: 'delete', positional: ['DEV'] }),
          null,
        );
      } finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
      }

      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe('delete');
      expect(captured[0].path).toBe('/api/v1/workspaces/test-ws/projects/p1/');
      expect(stdout).toContain('Deleted project');
      expect(stdout).toContain('DEV');
      expect(stderr).toContain('Deleting project');
      expect(stderr).toContain('permanently removes');
    });

    it('with --json returns structured output', async () => {
      let captured = '';
      const original = process.stdout.write;
      process.stdout.write = (chunk) => {
        captured += String(chunk);
        return true;
      };
      // Suppress stderr warning
      const origErr = process.stderr.write;
      process.stderr.write = () => true;
      try {
        await handleProject(
          ctx(baseResponses()),
          mockArgs({
            subcommand: 'delete',
            positional: ['DEV'],
            flags: { json: true },
          }),
          null,
        );
      } finally {
        process.stdout.write = original;
        process.stderr.write = origErr;
      }
      const parsed = JSON.parse(captured);
      expect(parsed.deleted).toBe(true);
      expect(parsed.identifier).toBe('DEV');
    });

    it('with no project errors', async () => {
      await expect(
        handleProject(ctx(baseResponses()), mockArgs({ subcommand: 'delete' }), null),
      ).rejects.toThrow(/Usage: pl project delete/);
    });
  });

  describe('unknown subcommand', () => {
    it('errors with usage', async () => {
      await expect(
        handleProject(ctx(baseResponses()), mockArgs({ subcommand: 'foo' }), null),
      ).rejects.toThrow(/Usage: pl project/);
    });
  });

  describe('auto-detect markdown in --body', () => {
    it('create with markdown body converts to HTML', async () => {
      const captured: CapturedRequest[] = [];
      await capturedOutput(() =>
        handleProject(
          ctx(new Map(), captured),
          mockArgs({
            subcommand: 'create',
            flags: { name: 'Foo', identifier: 'FOO', body: '## Overview\n\n[plan](https://x.com)' },
          }),
          null,
        ),
      );
      const description = (captured[0].body as Record<string, unknown>).description as string;
      expect(description).toContain('<h2>Overview</h2>');
      expect(description).toContain('<a href="https://x.com">plan</a>');
    });
  });
});
