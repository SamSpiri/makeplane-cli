import { describe, it, expect } from 'vitest';
import { PlaneClient } from '../../plane-client.js';
import { ResolverContext } from '../resolvers.js';
import { handleWrite } from '../commands/write.js';
import { handleLabel } from '../commands/label.js';

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
    command: 'create',
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

describe('handleWrite', () => {
  it('close resolves completed state and updates', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's-open', name: 'Open', group: 'started' },
      assignees: [],
      labels: [],
    });
    responses.set('/api/v1/workspaces/test-ws/projects/p1/states/', {
      results: [
        { id: 's-done', name: 'Done', group: 'completed' },
        { id: 's-open', name: 'Open', group: 'started' },
      ],
    });

    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'close',
          positional: ['DEV-42'],
        }),
        null,
      ),
    );

    expect(out).toContain('Closed');
    expect(out).toContain('DEV-42');
    expect(out).toContain('Done');
  });

  it('delete resolves work item and calls DELETE on work-items path', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's-open', name: 'Open', group: 'started' },
      assignees: [],
      labels: [],
    });

    const captured: CapturedRequest[] = [];
    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'delete',
          positional: ['DEV-42'],
        }),
        null,
      ),
    );

    expect(out).toContain('Deleted');
    expect(out).toContain('DEV-42');
    const del = captured.find((c) => c.method === 'delete');
    expect(del?.path).toBe('/api/v1/workspaces/test-ws/projects/p1/work-items/wi-uuid/');
  });

  it('dep remove calls the relation removal endpoint', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid', project_id: 'p1', sequence_id: 42, name: 'Fix bug',
      priority: 'high', state: { id: 's1', name: 'Todo', group: 'unstarted' },
      assignees: [], labels: [],
    });
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-7/', {
      id: 'target-uuid', project_id: 'p1', sequence_id: 7, name: 'Other bug',
      priority: 'high', state: { id: 's1', name: 'Todo', group: 'unstarted' },
      assignees: [], labels: [],
    });
    responses.set('/api/v1/workspaces/test-ws/projects/p1/issues/wi-uuid/relations/', {
      blocked_by: ['target-uuid'],
    });

    const captured: CapturedRequest[] = [];
    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({ command: 'dep', subcommand: 'remove', positional: ['DEV-42', 'DEV-7'] }),
        null,
      ),
    );

    const remove = captured.find((c) => c.method === 'post');
    expect(remove?.path).toBe(
      '/api/v1/workspaces/test-ws/projects/p1/work-items/wi-uuid/relations/remove/',
    );
    expect(remove?.body).toEqual({ related_issue: 'target-uuid' });
  });

  it('reopen resolves unstarted state and updates', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's-done', name: 'Done', group: 'completed' },
      assignees: [],
      labels: [],
    });
    responses.set('/api/v1/workspaces/test-ws/projects/p1/states/', {
      results: [
        { id: 's-done', name: 'Done', group: 'completed' },
        { id: 's-todo', name: 'Todo', group: 'unstarted' },
      ],
    });

    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'reopen',
          positional: ['DEV-42'],
        }),
        null,
      ),
    );

    expect(out).toContain('Reopened');
    expect(out).toContain('DEV-42');
    expect(out).toContain('Todo');
  });

  it('assign sets assignee', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's1', name: 'Todo', group: 'unstarted' },
      assignees: [],
      labels: [],
    });
    responses.set('/api/v1/workspaces/test-ws/members/', {
      results: [{ id: 'u-alice', email: 'alice@example.com', display_name: 'Alice' }],
    });

    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'assign',
          positional: ['DEV-42', 'alice@example.com'],
        }),
        null,
      ),
    );

    expect(out).toContain('Alice');
  });

  it('label add adds label', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's1', name: 'Todo', group: 'unstarted' },
      assignees: [],
      labels: [{ id: 'l-existing', name: 'existing' }],
    });
    responses.set('/api/v1/workspaces/test-ws/projects/p1/labels/', {
      results: [
        { id: 'l-backend', name: 'backend' },
        { id: 'l-existing', name: 'existing' },
      ],
    });

    const out = await capturedOutput(() =>
      handleLabel(
        ctx(responses),
        mockArgs({
          command: 'label',
          subcommand: 'add',
          positional: ['DEV-42', 'backend'],
        }),
        null,
      ),
    );

    expect(out).toContain('Added');
    expect(out).toContain('backend');
  });

  it('comment posts a comment', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', {
      id: 'wi-uuid',
      project_id: 'p1',
      sequence_id: 42,
      name: 'Fix bug',
      priority: 'high',
      state: { id: 's1', name: 'Todo', group: 'unstarted' },
      assignees: [],
      labels: [],
    });

    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: 'Verified in staging' },
        }),
        null,
      ),
    );

    expect(out).toContain('Commented');
    expect(out).toContain('DEV-42');
  });

  it('create prints identifier', async () => {
    const responses = baseResponses();

    const out = await capturedOutput(() =>
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'create',
          flags: { project: 'DEV', title: 'Fix OAuth bug' },
        }),
        null,
      ),
    );

    expect(out).toContain('DEV-99');
  });
});

// ── --format input parsing on create / update / comment ──

function workItemResponse(): Record<string, unknown> {
  return {
    id: 'wi-uuid',
    project_id: 'p1',
    sequence_id: 42,
    name: 'Fix bug',
    priority: 'high',
    state: { id: 's1', name: 'Todo', group: 'unstarted' },
    assignees: [],
    labels: [],
  };
}

describe('handleWrite --format input parsing', () => {
  it('create with --body defaults to plain-text wrapper', async () => {
    const responses = baseResponses();
    const captured: CapturedRequest[] = [];

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'create',
          flags: { project: 'DEV', title: 'T', body: 'hello world' },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post');
    expect(post).toBeDefined();
    expect((post!.body as Record<string, unknown>).description_html).toBe('<p>hello world</p>');
  });

  it('create with --format html passes body through unchanged', async () => {
    const responses = baseResponses();
    const captured: CapturedRequest[] = [];
    const raw = '<p>raw <strong>HTML</strong></p>';

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'create',
          flags: { project: 'DEV', title: 'T', body: raw, format: 'html' },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post');
    expect((post!.body as Record<string, unknown>).description_html).toBe(raw);
  });

  it('create with --format markdown converts markdown to HTML', async () => {
    const responses = baseResponses();
    const captured: CapturedRequest[] = [];

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'create',
          flags: {
            project: 'DEV',
            title: 'T',
            body: '## Summary\n- **bold** item',
            format: 'markdown',
          },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post');
    const html = (post!.body as Record<string, unknown>).description_html as string;
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<li><strong>bold</strong> item</li>');
  });

  it('create with invalid --format errors out', async () => {
    const responses = baseResponses();

    await expect(
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'create',
          flags: { project: 'DEV', title: 'T', body: 'x', format: 'json' },
        }),
        null,
      ),
    ).rejects.toThrow(/Invalid --format/);
  });

  it('update with --format html passes body through', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];
    const raw = '<p>new <em>body</em></p>';

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'update',
          positional: ['DEV-42'],
          flags: { body: raw, format: 'html' },
        }),
        null,
      ),
    );

    const patch = captured.find((c) => c.method === 'patch');
    expect((patch!.body as Record<string, unknown>).description_html).toBe(raw);
  });

  it('update with --format markdown converts markdown to HTML', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'update',
          positional: ['DEV-42'],
          flags: { body: 'plain text with `code`', format: 'markdown' },
        }),
        null,
      ),
    );

    const patch = captured.find((c) => c.method === 'patch');
    const html = (patch!.body as Record<string, unknown>).description_html as string;
    expect(html).toContain('<code>code</code>');
  });

  it('comment with --format html passes text through', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];
    const raw = '<p>raw <a href="https://x.com">link</a></p>';

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: raw, format: 'html' },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post' && c.path.includes('/comments/'));
    expect((post!.body as Record<string, unknown>).comment_html).toBe(raw);
  });

  it('comment with --format markdown converts markdown to HTML', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: '## Update\n\n- item one\n- item two', format: 'markdown' },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post' && c.path.includes('/comments/'));
    const html = (post!.body as Record<string, unknown>).comment_html as string;
    expect(html).toContain('<h2>Update</h2>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
  });

  it('comment without --format uses plain-text wrapper (regression)', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];

    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: 'Verified in staging' },
        }),
        null,
      ),
    );

    const post = captured.find((c) => c.method === 'post' && c.path.includes('/comments/'));
    expect((post!.body as Record<string, unknown>).comment_html).toBe('<p>Verified in staging</p>');
  });

  it('comment with invalid --format errors out', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());

    await expect(
      handleWrite(
        ctx(responses),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: 'hi', format: 'json' },
        }),
        null,
      ),
    ).rejects.toThrow(/Invalid --format/);
  });
});

// ── auto-detect markdown in --body when --format is omitted ──

describe('handleWrite auto-detect markdown', () => {
  it('create with markdown body auto-switches', async () => {
    const responses = baseResponses();
    const captured: CapturedRequest[] = [];
    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'create',
          flags: { project: 'DEV', title: 'T', body: '## Summary\n\n- one\n- two' },
        }),
        null,
      ),
    );
    const post = captured.find((c) => c.method === 'post');
    const html = (post!.body as Record<string, unknown>).description_html as string;
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('<li>one</li>');
  });

  it('comment with markdown body auto-switches', async () => {
    const responses = baseResponses();
    responses.set('/api/v1/workspaces/test-ws/issues/DEV-42/', workItemResponse());
    const captured: CapturedRequest[] = [];
    await capturedOutput(() =>
      handleWrite(
        ctx(responses, captured),
        mockArgs({
          command: 'comment',
          positional: ['DEV-42'],
          flags: { body: '## Update\n\n[link](https://x.com)' },
        }),
        null,
      ),
    );
    const post = captured.find((c) => c.method === 'post' && c.path.includes('/comments/'));
    const html = (post!.body as Record<string, unknown>).comment_html as string;
    expect(html).toContain('<h2>Update</h2>');
    expect(html).toContain('<a href="https://x.com">link</a>');
  });
});
