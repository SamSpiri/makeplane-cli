import { describe, it, expect } from 'vitest';
import {
  formatProjects,
  formatProjectShow,
  formatStatus,
  formatWorkItemList,
  formatWorkItemShow,
} from '../formatters.js';
import type { ProjectInfo } from '../resolvers.js';

const project: ProjectInfo = {
  id: 'proj-uuid',
  identifier: 'DEV',
  name: 'Development',
};

describe('formatWorkItemList', () => {
  it('shows empty message for no items', () => {
    const result = formatWorkItemList([], 'DEV');
    expect(result).toContain('no work items');
  });

  it('formats items with status glyphs and priority', () => {
    const items = [
      {
        sequence_id: 42,
        name: 'Fix login bug',
        priority: 'high',
        state: { name: 'In Progress', group: 'started' },
      },
      {
        sequence_id: 43,
        name: 'Add tests',
        priority: 'low',
        state: { name: 'Backlog', group: 'backlog' },
      },
    ];
    const result = formatWorkItemList(items, 'DEV');
    expect(result).toContain('DEV-42');
    expect(result).toContain('Fix login bug');
    expect(result).toContain('P1');
    expect(result).toContain('DEV-43');
    expect(result).toContain('P3');
  });
});

describe('formatWorkItemShow', () => {
  it('formats a complete work item', () => {
    const item = {
      sequence_id: 42,
      name: 'Fix login bug',
      priority: 'urgent',
      state: { name: 'In Progress', group: 'started' },
      description_html: '<p>The login page crashes</p>',
      created_at: '2026-06-01T10:00:00Z',
      updated_at: '2026-06-02T12:00:00Z',
      assignees: [{ display_name: 'Alice', email: 'alice@example.com' }],
      labels: [{ name: 'bug' }, { name: 'frontend' }],
      cycle: { name: 'Sprint 12' },
    };
    const result = formatWorkItemShow(item, 'DEV-42', project, [], []);
    expect(result).toContain('DEV-42');
    expect(result).toContain('Fix login bug');
    expect(result).toContain('P0');
    expect(result).toContain('In Progress');
    expect(result).toContain('Alice');
    expect(result).toContain('bug, frontend');
    expect(result).toContain('Sprint 12');
    expect(result).toContain('DESCRIPTION');
    expect(result).toContain('The login page crashes');
  });

  it('shows relations', () => {
    const item = {
      sequence_id: 42,
      name: 'Task',
      priority: 'medium',
      state: { name: 'Todo', group: 'unstarted' },
    };
    const relations = [
      {
        relation_type: 'blocked_by',
        _display_id: '#7',
        issue: { sequence_id: 7, name: 'Dependency' },
      },
    ];
    const result = formatWorkItemShow(item, 'DEV-42', project, [], relations);
    expect(result).toContain('RELATIONS');
    expect(result).toContain('blocked_by');
    expect(result).toContain('#7');
    expect(result).toContain('Dependency');
  });

  it('shows comments', () => {
    const item = {
      sequence_id: 42,
      name: 'Task',
      priority: 'none',
      state: { name: 'Done', group: 'completed' },
    };
    const comments = [
      {
        actor: { display_name: 'Bob' },
        created_at: '2026-06-03',
        comment_html: '<p>Verified fix</p>',
      },
    ];
    const result = formatWorkItemShow(item, 'DEV-42', project, comments, []);
    expect(result).toContain('COMMENTS');
    expect(result).toContain('Bob');
    expect(result).toContain('Verified fix');
  });

  it('renders description in text mode by default', () => {
    const item = {
      sequence_id: 42,
      name: 'Test',
      priority: 'none',
      state: { name: 'Todo', group: 'unstarted' },
      description_html: '<h2>Heading</h2><p>Paragraph with <strong>bold</strong></p>',
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], []);
    // Terminal mode: should contain rendered text without HTML tags
    expect(result).toContain('Heading');
    expect(result).toContain('bold');
    expect(result).not.toContain('<h2>');
    expect(result).not.toContain('<strong>');
  });

  it('renders description in markdown mode', () => {
    const item = {
      sequence_id: 42,
      name: 'Test',
      priority: 'none',
      state: { name: 'Todo', group: 'unstarted' },
      description_html: '<h2>Heading</h2><p>Paragraph with <strong>bold</strong></p>',
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], [], 'markdown');
    expect(result).toContain('## Heading');
    expect(result).toContain('**bold**');
  });

  it('renders description in html mode', () => {
    const item = {
      sequence_id: 42,
      name: 'Test',
      priority: 'none',
      state: { name: 'Todo', group: 'unstarted' },
      description_html: '<h2>Heading</h2>',
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], [], 'html');
    expect(result).toContain('<h2>Heading</h2>');
  });

  it('renders comments in text mode with formatting', () => {
    const item = {
      sequence_id: 42,
      name: 'Task',
      priority: 'none',
      state: { name: 'Done', group: 'completed' },
    };
    const comments = [
      {
        actor: { display_name: 'Bob' },
        created_at: '2026-06-03',
        comment_html: '<p><strong>Verified</strong> fix</p>',
      },
    ];
    const result = formatWorkItemShow(item, 'DEV-42', null, comments, []);
    expect(result).toContain('Verified');
    expect(result).not.toContain('<strong>');
  });

  it('handles missing project', () => {
    const item = {
      sequence_id: 42,
      name: 'Task',
      priority: 'none',
      state: { name: 'Todo', group: 'unstarted' },
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], []);
    expect(result).toContain('DEV-42');
  });

  it('has no ANSI escapes in markdown mode', () => {
    const item = {
      sequence_id: 42,
      name: 'Test',
      priority: 'high',
      state: { name: 'Todo', group: 'unstarted' },
      description_html: '<p>text</p>',
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], [], 'markdown');
    // eslint-disable-next-line no-control-regex
    const ansi = result.match(/\x1b\[[0-9;]*m/g);
    expect(ansi).toBeNull();
  });

  it('has ANSI escapes in text mode', () => {
    const item = {
      sequence_id: 42,
      name: 'Test',
      priority: 'high',
      state: { name: 'Todo', group: 'unstarted' },
      description_html: '<p>text</p>',
    };
    const result = formatWorkItemShow(item, 'DEV-42', null, [], []);
    // eslint-disable-next-line no-control-regex
    const ansi = result.match(/\x1b\[[0-9;]*m/g);
    expect(ansi).not.toBeNull();
  });
});

describe('formatProjects', () => {
  it('shows empty message', () => {
    expect(formatProjects([])).toContain('no projects');
  });

  it('formats project list', () => {
    const projects: ProjectInfo[] = [
      { id: 'uuid-1', identifier: 'DEV', name: 'Development' },
      { id: 'uuid-2', identifier: 'OPS', name: 'Operations' },
    ];
    const result = formatProjects(projects);
    expect(result).toContain('DEV');
    expect(result).toContain('Development');
    expect(result).toContain('OPS');
  });
});

describe('formatStatus', () => {
  it('formats group summary', () => {
    const byGroup = {
      backlog: 3,
      unstarted: 1,
      started: 5,
      completed: 12,
      cancelled: 2,
    };
    const byState = {};
    const result = formatStatus(byGroup, byState, 23);
    expect(result).toContain('backlog: 3');
    expect(result).toContain('started: 5');
    expect(result).toContain('completed: 12');
    expect(result).toContain('total: 23');
  });
});

describe('formatProjectShow', () => {
  const proj: ProjectInfo = { id: 'p1', identifier: 'DEV', name: 'Development' };

  it('renders HTML description as formatted text by default', () => {
    const result = formatProjectShow(proj, { description: '<p>hello</p>' });
    expect(result).not.toContain('<p>');
    expect(result).toContain('hello');
  });

  it('with format=html passes description through', () => {
    const result = formatProjectShow(proj, { description: '<p>hello</p>' }, 'html');
    expect(result).toContain('<p>hello</p>');
  });

  it('with format=markdown converts description to markdown', () => {
    const result = formatProjectShow(proj, { description: '<h2>Title</h2>' }, 'markdown');
    expect(result).toContain('## Title');
  });

  it('with no description skips section', () => {
    const result = formatProjectShow(proj, {});
    expect(result).not.toContain('DESCRIPTION');
  });
});
