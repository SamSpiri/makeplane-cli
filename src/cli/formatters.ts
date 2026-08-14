import { dim, bold, cyan } from './output.js';
import { renderRichHtml } from './html.js';
import type { RenderMode } from './html.js';
import type { ProjectInfo, CycleInfo, ModuleInfo, StateInfo, LabelInfo } from './resolvers.js';

type JsonObject = Record<string, unknown>;

export type OutputFormat = 'text' | 'markdown' | 'html';

// Canonical state-group ordering + glyphs. Single source of truth used by
// every state/cycle/module display path. Do not duplicate elsewhere.
export const STATE_GROUP_ORDER: readonly string[] = [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'cancelled',
];

export const STATUS_GLYPHS: Record<string, string> = {
  backlog: '○',
  unstarted: '◌',
  started: '◐',
  completed: '●',
  cancelled: '✕',
};

export const CYCLE_GLYPHS: Record<string, string> = {
  draft: '○',
  unstarted: '◌',
  started: '◐',
  in_progress: '◐',
  completed: '●',
  cancelled: '✕',
};

export const MODULE_GLYPHS: Record<string, string> = {
  backlog: '○',
  planned: '◌',
  in_progress: '◐',
  paused: '◌',
  completed: '●',
  cancelled: '✕',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
  none: 'P4',
};

function stateGroup(item: JsonObject): string {
  const state = item.state as JsonObject | undefined;
  return (state?.group as string) || (item.state_group as string) || '';
}

function stateName(item: JsonObject): string {
  const state = item.state as JsonObject | undefined;
  return (state?.name as string) || '';
}

function priorityLabel(p: unknown): string {
  const s = String(p || 'none').toLowerCase();
  return PRIORITY_LABELS[s] || s;
}

function assigneeNames(item: JsonObject): string {
  const assignees = item.assignees as JsonObject[] | undefined;
  if (!assignees || assignees.length === 0) return '';
  return assignees
    .map((a) => (a.display_name as string) || (a.email as string) || '')
    .filter(Boolean)
    .join(', ');
}

function labelNames(item: JsonObject): string {
  const labels = item.labels as JsonObject[] | undefined;
  if (!labels || labels.length === 0) return '';
  return labels
    .map((l) => (l.name as string) || '')
    .filter(Boolean)
    .join(', ');
}

function dateStr(d: unknown): string {
  if (!d) return '';
  const s = String(d);
  return s.slice(0, 10);
}

function formatWorkItemRow(item: JsonObject, projectIdentifier: string): string {
  const seq = item.sequence_id as number;
  const id = `${projectIdentifier}-${seq}`;
  const glyph = STATUS_GLYPHS[stateGroup(item)] || ' ';
  const pri = priorityLabel(item.priority);
  const name = (item.name as string) || '';
  return `${glyph} ${bold(id)} ${cyan(pri)} ${name}`;
}

// ── Mode-aware helpers ──

function styleIdentifier(id: string, format: OutputFormat): string {
  return format === 'markdown' ? id : bold(id);
}

function stylePriority(pri: string, format: OutputFormat): string {
  return format === 'markdown' ? pri : cyan(pri);
}

function styleSectionLabel(label: string, format: OutputFormat): string {
  if (format === 'markdown') return label;
  return bold(label);
}

function renderRichBody(html: string, format: OutputFormat): string {
  if (format === 'html') return html;
  const renderMode: RenderMode = format === 'markdown' ? 'markdown' : 'text';
  return renderRichHtml(html, renderMode);
}

// ── Public exports ──

export function formatWorkItemList(items: JsonObject[], projectIdentifier: string): string {
  if (items.length === 0) return dim('(no work items)');

  return items.map((item) => formatWorkItemRow(item, projectIdentifier)).join('\n');
}

export function formatWorkItemShow(
  item: JsonObject,
  identifier: string,
  project: ProjectInfo | null,
  comments: JsonObject[],
  relations: JsonObject[],
  format?: OutputFormat,
): string {
  const fmt: OutputFormat = format ?? 'text';

  const glyph = STATUS_GLYPHS[stateGroup(item)] || ' ';
  const pri = priorityLabel(item.priority);
  const name = (item.name as string) || '';
  const sn = stateName(item);
  const sg = stateGroup(item);
  const projectName = project?.name || '';

  const lines: string[] = [];

  // Header
  lines.push(
    `${glyph} ${styleIdentifier(identifier, fmt)} · ${name}  [${stylePriority(pri, fmt)} · ${sn || sg || '?'}]`,
  );

  if (projectName) {
    lines.push(`Project: ${projectName}`);
  }

  const a = assigneeNames(item);
  if (a) lines.push(`Assignee: ${a}`);

  if (sn && sg) lines.push(`State: ${sn} (${sg})`);
  else if (sn) lines.push(`State: ${sn}`);

  const created = dateStr(item.created_at);
  const updated = dateStr(item.updated_at);
  if (created) {
    lines.push(
      `Created: ${created}${updated && updated !== created ? ` · Updated: ${updated}` : ''}`,
    );
  }

  const lbs = labelNames(item);
  if (lbs) lines.push(`Labels: ${lbs}`);

  const cycle = item.cycle as JsonObject | undefined;
  if (cycle?.name) lines.push(`Cycle: ${cycle.name}`);

  const mod = item.module as JsonObject | undefined;
  if (mod?.name) lines.push(`Module: ${mod.name}`);

  // Description
  const desc = item.description_html as string | undefined;
  if (desc) {
    lines.push('');
    lines.push(styleSectionLabel('DESCRIPTION', fmt));
    lines.push(renderRichBody(desc, fmt));
  }

  // Relations
  if (relations && relations.length > 0) {
    lines.push('');
    lines.push(styleSectionLabel('RELATIONS', fmt));
    for (const rel of relations) {
      const rtype = rel.relation_type as string;
      const related = rel.issue as JsonObject | undefined;
      const rname = (related?.name as string) || '';
      const rid = (rel._display_id as string) || '[unresolved issue id]';
      const arrow = rtype === 'blocked_by' ? '←' : rtype === 'blocks' ? '→' : '↔';
      lines.push(`  ${arrow} ${rtype} ${rid}${rname ? `: ${rname}` : ''}`);
    }
  }

  // Comments
  if (comments && comments.length > 0) {
    lines.push('');
    lines.push(styleSectionLabel('COMMENTS', fmt));
    for (const c of comments) {
      const actor = c.actor as JsonObject | undefined;
      const actorName = (actor?.display_name as string) || (actor?.email as string) || '?';
      const cdate = dateStr(c.created_at);
      const cbody = c.comment_html ? renderRichBody(String(c.comment_html), fmt) : '';
      lines.push(`  ${actorName} · ${cdate}`);
      if (cbody) lines.push(`  ${cbody}`);
    }
  }

  return lines.join('\n');
}

export function formatProjects(projects: ProjectInfo[]): string {
  if (projects.length === 0) return dim('(no projects)');

  return projects
    .map((p) => {
      return `${bold(p.identifier)}  ${p.name}  ${dim(p.id)}`;
    })
    .join('\n');
}

export function formatStates(states: StateInfo[]): string {
  if (states.length === 0) return dim('(no states)');
  const rank = (g: string): number => {
    const i = STATE_GROUP_ORDER.indexOf(g);
    return i === -1 ? STATE_GROUP_ORDER.length : i;
  };
  return [...states]
    .sort((a, b) => rank(a.group) - rank(b.group) || a.name.localeCompare(b.name))
    .map((s) => `${STATUS_GLYPHS[s.group] || ' '} ${bold(s.name)} ${dim(`[${s.group}]`)}`)
    .join('\n');
}

function memberDisplay(member: unknown): string {
  if (!member || typeof member !== 'object') return '—';
  const m = member as JsonObject;
  return (m.display_name as string) || (m.email as string) || '—';
}

export function formatProjectShow(
  project: ProjectInfo,
  detail: JsonObject,
  format?: OutputFormat,
): string {
  const fmt: OutputFormat = format ?? 'text';
  const name = (detail.name as string) || project.name;
  const description = (detail.description as string) || '';
  const network =
    typeof detail.network === 'number' ? (detail.network === 0 ? 'secret' : 'public') : '—';
  const lead = memberDisplay(detail.project_lead);
  const defaultAssignee = memberDisplay(detail.default_assignee);

  const totalMembers = typeof detail.total_members === 'number' ? detail.total_members : null;
  const totalCycles = typeof detail.total_cycles === 'number' ? detail.total_cycles : null;
  const totalModules = typeof detail.total_modules === 'number' ? detail.total_modules : null;

  const created = dateStr(detail.created_at);
  const updated = dateStr(detail.updated_at);

  const lines: string[] = [];
  lines.push(`${styleIdentifier(project.identifier, fmt)}  ${name}`);
  lines.push(`Visibility: ${network}`);

  if (lead !== '—') lines.push(`Lead: ${lead}`);
  if (defaultAssignee !== '—') lines.push(`Default assignee: ${defaultAssignee}`);

  const counts: string[] = [];
  if (totalMembers !== null) counts.push(`members: ${totalMembers}`);
  if (totalCycles !== null) counts.push(`cycles: ${totalCycles}`);
  if (totalModules !== null) counts.push(`modules: ${totalModules}`);
  if (counts.length > 0) lines.push(counts.join('  '));

  if (created) {
    lines.push(
      `Created: ${created}${updated && updated !== created ? ` · Updated: ${updated}` : ''}`,
    );
  }

  if (description.trim()) {
    lines.push('');
    lines.push(styleSectionLabel('DESCRIPTION', fmt));
    lines.push(renderRichBody(description, fmt));
  }

  return lines.join('\n');
}

export function formatStatus(
  byGroup: Record<string, number>,
  _byState: Record<string, number>,
  total: number,
): string {
  const lines: string[] = [];

  for (const g of STATE_GROUP_ORDER) {
    const count = byGroup[g] || 0;
    const glyph = STATUS_GLYPHS[g] || ' ';
    lines.push(`${glyph} ${g}: ${count}`);
  }

  lines.push(`${dim('───')}`);
  lines.push(`total: ${total}`);

  return lines.join('\n');
}

export function formatCycleList(cycles: CycleInfo[]): string {
  if (cycles.length === 0) return dim('(no cycles)');

  return cycles
    .map((c) => {
      const parts: string[] = [];

      if (c.status) {
        const glyph = CYCLE_GLYPHS[c.status] || ' ';
        parts.push(`${glyph} ${c.name}`);
        parts.push(`[${c.status}]`);
      } else {
        parts.push(c.name);
      }

      if (c.start_date && c.end_date) {
        parts.push(`${dateStr(c.start_date)} → ${dateStr(c.end_date)}`);
      }

      if (c.total_issues !== null) {
        const label = c.total_issues === 1 ? 'issue' : 'issues';
        parts.push(`${c.total_issues} ${label}`);
      }

      return parts.join('  ');
    })
    .join('\n');
}

export function formatModuleList(modules: ModuleInfo[]): string {
  if (modules.length === 0) return dim('(no modules)');

  return modules
    .map((m) => {
      const glyph = MODULE_GLYPHS[m.status || ''] || ' ';
      const parts: string[] = [`${glyph} ${m.name}`];

      if (m.status) {
        parts.push(`[${m.status}]`);
      }

      if (m.target_date) {
        parts.push(`target ${dateStr(m.target_date)}`);
      }

      if (m.total_issues !== null) {
        const label = m.total_issues === 1 ? 'issue' : 'issues';
        parts.push(`${m.total_issues} ${label}`);
      }

      return parts.join('  ');
    })
    .join('\n');
}

function countItemsByState(items: JsonObject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const sg = stateGroup(item);
    if (sg) counts[sg] = (counts[sg] || 0) + 1;
  }
  return counts;
}

// Fixed display order for cycle/module issue counters. Always emit every
// bucket so output stays visually stable across modules/cycles.
const STATS_ORDER = ['total', 'completed', 'started', 'unstarted', 'backlog', 'cancelled'] as const;

function issueStats(items: JsonObject[]): string {
  const counts = countItemsByState(items);
  const parts: string[] = [];
  for (const label of STATS_ORDER) {
    const v = label === 'total' ? items.length : counts[label] || 0;
    parts.push(`${label}: ${v}`);
  }
  return parts.join('  ');
}

function showIssuesSection(items: JsonObject[], projectIdentifier: string): string[] {
  const lines: string[] = [];
  lines.push(`ISSUES`);
  lines.push(`  ${issueStats(items)}`);
  if (items.length > 0) {
    lines.push('');
    for (const item of items) {
      lines.push(`  ${formatWorkItemRow(item, projectIdentifier)}`);
    }
  }
  return lines;
}

function normalizeStatus(s: string): string {
  return s.replace(/-/g, '_');
}

export function formatCycleShow(
  detail: JsonObject,
  items: JsonObject[],
  projectIdentifier: string,
  format?: OutputFormat,
): string {
  const fmt: OutputFormat = format ?? 'text';
  const name = (detail.name as string) || '';
  const status = (detail.status as string) || '';
  const start = dateStr(detail.start_date);
  const end = dateStr(detail.end_date);
  const description = (detail.description as string) || '';
  const glyph = CYCLE_GLYPHS[status] || '';

  const lines: string[] = [];
  lines.push(glyph ? `${glyph} ${bold(name)}` : bold(name));
  if (status) lines.push(`Status: ${status}`);
  if (start || end) {
    lines.push(`Period: ${start || '?'} → ${end || '?'}`);
  }

  const issueLines = showIssuesSection(items, projectIdentifier);
  if (issueLines.length > 0) {
    lines.push('');
    lines.push(...issueLines);
  }

  if (description.trim()) {
    lines.push('');
    lines.push(styleSectionLabel('DESCRIPTION', fmt));
    lines.push(renderRichBody(description, fmt));
  }

  return lines.join('\n');
}

export function formatModuleShow(
  detail: JsonObject,
  items: JsonObject[],
  projectIdentifier: string,
  format?: OutputFormat,
): string {
  const fmt: OutputFormat = format ?? 'text';
  const name = (detail.name as string) || '';
  const status = (detail.status as string) || '';
  const start = dateStr(detail.start_date);
  const target = dateStr(detail.target_date);
  const description = (detail.description as string) || '';
  const glyph = MODULE_GLYPHS[normalizeStatus(status)] || '';

  const lines: string[] = [];
  lines.push(glyph ? `${glyph} ${bold(name)}` : bold(name));
  if (status) lines.push(`Status: ${status}`);
  if (start || target) {
    lines.push(`Period: ${start || '?'} → ${target || '?'}`);
  }

  const issueLines = showIssuesSection(items, projectIdentifier);
  if (issueLines.length > 0) {
    lines.push('');
    lines.push(...issueLines);
  }

  if (description.trim()) {
    lines.push('');
    lines.push(styleSectionLabel('DESCRIPTION', fmt));
    lines.push(renderRichBody(description, fmt));
  }

  return lines.join('\n');
}

interface ItemGroup {
  groupName: string;
  groupGlyph: string;
  groupKey?: string;
  items: JsonObject[];
}

export function formatGroupedWorkItems(
  groups: ItemGroup[],
  projectIdentifier: string,
  groupBy?: 'cycle' | 'module' | 'state' | 'prio',
): string {
  if (groups.every((g) => g.items.length === 0)) {
    return dim('(no work items)');
  }

  const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low', 'none'];

  let sorted: ItemGroup[];
  if (groupBy === 'state') {
    sorted = [...groups].sort((a, b) => {
      const aKey = a.groupKey ?? '';
      const bKey = b.groupKey ?? '';
      if (aKey === '__no_state__' && bKey === '__no_state__') return 0;
      if (aKey === '__no_state__') return 1;
      if (bKey === '__no_state__') return -1;
      const aIdx = STATE_GROUP_ORDER.indexOf(aKey);
      const bIdx = STATE_GROUP_ORDER.indexOf(bKey);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.groupName.localeCompare(b.groupName);
    });
  } else if (groupBy === 'prio') {
    sorted = [...groups].sort((a, b) => {
      const aKey = a.groupKey ?? '';
      const bKey = b.groupKey ?? '';
      if (aKey === '__no_priority__' && bKey === '__no_priority__') return 0;
      if (aKey === '__no_priority__') return 1;
      if (bKey === '__no_priority__') return -1;
      const aIdx = PRIORITY_ORDER.indexOf(aKey);
      const bIdx = PRIORITY_ORDER.indexOf(bKey);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.groupName.localeCompare(b.groupName);
    });
  } else {
    sorted = [...groups].sort((a, b) => {
      const aIsOrphan = a.groupName.startsWith('(No ');
      const bIsOrphan = b.groupName.startsWith('(No ');
      if (aIsOrphan && !bIsOrphan) return 1;
      if (!aIsOrphan && bIsOrphan) return -1;
      if (aIsOrphan && bIsOrphan) return 0;
      return a.groupName.localeCompare(b.groupName);
    });
  }

  const lines: string[] = [];

  for (const group of sorted) {
    if (group.items.length === 0) continue;
    lines.push(`${group.groupGlyph} ${bold(group.groupName)}`);
    for (const item of group.items) {
      lines.push(`  ${formatWorkItemRow(item, projectIdentifier)}`);
    }
  }

  return lines.join('\n');
}

export function formatLabelList(labels: LabelInfo[]): string {
  if (labels.length === 0) return dim('(no labels)');

  return labels.map((l) => `${bold(l.name)}  ${dim(l.id)}`).join('\n');
}
