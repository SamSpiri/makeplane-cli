import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson, bold, dim } from '../output.js';
import type { OutputFormat } from '../formatters.js';
import {
  formatWorkItemList,
  formatWorkItemShow,
  formatProjects,
  formatStatus,
  formatStates,
  formatGroupedWorkItems,
  STATUS_GLYPHS,
  CYCLE_GLYPHS,
  MODULE_GLYPHS,
  STATE_GROUP_ORDER,
} from '../formatters.js';
import { resolveShowFormat } from './_helpers.js';

type JsonObject = Record<string, unknown>;
type JsonArray = JsonObject[];

function priorityValue(input: string): string {
  const map: Record<string, string> = {
    p0: 'urgent',
    p1: 'high',
    p2: 'medium',
    p3: 'low',
    p4: 'none',
  };
  return map[input.toLowerCase()] || input;
}

async function getProjectArg(
  ctx: ResolverContext,
  flags: Record<string, string | boolean>,
  defaultProject: string | null,
): Promise<string> {
  if (flags.project) return (await ctx.resolveProject(flags.project as string)).id;

  if (defaultProject) return (await ctx.resolveProject(defaultProject)).id;

  throw new Error('No project specified. Use --project or set PLANE_DEFAULT_PROJECT.');
}

// The Plane `GET /projects/{id}/work-items/` endpoint accepts only
// `cursor`, `expand`, `external_*`, `fields`, `order_by`, `per_page` as
// query parameters. State/priority/label/assignee/cycle/module are ignored
// by the server, so we resolve the human input to IDs and filter
// client-side after the fetch.
type FilterPlan = {
  stateId?: string;
  priority?: string;
  labelId?: string;
  assigneeId?: string;
  cycleIssueIds?: Set<string>;
  moduleIssueIds?: Set<string>;
};

function isEmptyPlan(plan: FilterPlan): boolean {
  return (
    !plan.stateId &&
    !plan.priority &&
    !plan.labelId &&
    !plan.assigneeId &&
    !plan.cycleIssueIds &&
    !plan.moduleIssueIds
  );
}

async function resolveFilters(
  ctx: ResolverContext,
  flags: Record<string, string | boolean>,
  projectId: string,
): Promise<{ qs: Record<string, string>; plan: FilterPlan }> {
  const qs: Record<string, string> = {};
  const plan: FilterPlan = {};

  if (flags.state) {
    const st = await ctx.resolveState(projectId, flags.state as string);
    plan.stateId = st.id;
  }
  if (flags.label) {
    const lb = await ctx.resolveLabel(projectId, flags.label as string);
    plan.labelId = lb.id;
  }
  if (flags.assignee) {
    const mb = await ctx.resolveMember(flags.assignee as string);
    plan.assigneeId = mb.id;
  }
  if (flags.cycle) {
    const cy = await ctx.resolveCycle(projectId, flags.cycle as string);
    plan.cycleIssueIds = new Set(await ctx.loadCycleIssueIds(projectId, cy.id));
  }
  if (flags.module) {
    const md = await ctx.resolveModule(projectId, flags.module as string);
    plan.moduleIssueIds = new Set(await ctx.loadModuleIssueIds(projectId, md.id));
  }
  if (flags.priority) {
    plan.priority = priorityValue(flags.priority as string);
  }
  if (flags.limit) {
    qs.per_page = String(flags.limit);
  }

  return { qs, plan };
}

function applyClientFilters(items: JsonArray, plan: FilterPlan): JsonArray {
  return items.filter((it) => {
    if (plan.stateId) {
      const st = it.state as JsonObject | string | undefined;
      const id = st && typeof st === 'object' ? (st.id as string) : (st as string | undefined);
      if (id !== plan.stateId) return false;
    }
    if (plan.priority) {
      if ((it.priority as string | null) !== plan.priority) return false;
    }
    if (plan.labelId) {
      const labels = (it.labels as string[] | undefined) || [];
      if (!labels.includes(plan.labelId)) return false;
    }
    if (plan.assigneeId) {
      const assignees = (it.assignees as string[] | undefined) || [];
      if (!assignees.includes(plan.assigneeId)) return false;
    }
    if (plan.cycleIssueIds) {
      if (!plan.cycleIssueIds.has(it.id as string)) return false;
    }
    if (plan.moduleIssueIds) {
      if (!plan.moduleIssueIds.has(it.id as string)) return false;
    }
    return true;
  });
}

function validateGroupBy(
  flags: Record<string, string | boolean>,
): 'cycle' | 'module' | 'state' | 'prio' | null {
  if (!flags.by) return null;
  const by = (flags.by as string).toLowerCase();
  if (by !== 'cycle' && by !== 'module' && by !== 'state' && by !== 'prio') {
    throw new Error(
      `Invalid --by value "${flags.by as string}". Must be one of: cycle, module, state, prio.`,
    );
  }
  return by;
}

function buildExpand(groupBy: 'cycle' | 'module' | 'state' | 'prio' | null): string {
  if (groupBy === 'cycle') return 'state,cycle';
  if (groupBy === 'module') return 'state,module';
  return 'state';
}

async function buildGroups(
  ctx: ResolverContext,
  items: JsonArray,
  projectId: string,
  groupBy: 'cycle' | 'module' | 'state' | 'prio',
) {
  type GroupEntry = { groupName: string; groupGlyph: string; groupKey: string; items: JsonArray };

  if (groupBy === 'cycle') {
    const groups = new Map<string, GroupEntry>();
    const ungrouped: JsonArray = [];
    const itemIds = new Set(items.map((i) => i.id as string).filter(Boolean));

    const cycles = await ctx.loadCycles(projectId);
    const cycleMemberIds = await Promise.all(
      cycles.map(async (c) => {
        const ids = await ctx.loadCycleIssueIds(projectId, c.id);
        return { cycle: c, ids: new Set(ids) };
      }),
    );

    const itemToCycle = new Map<string, string>();
    for (const { cycle, ids } of cycleMemberIds) {
      for (const id of ids) {
        if (itemIds.has(id)) itemToCycle.set(id, cycle.id);
      }
    }

    for (const item of items) {
      const cycleId = itemToCycle.get(item.id as string);
      const cycle = cycleId ? cycles.find((c) => c.id === cycleId) : undefined;
      if (cycle) {
        const glyph = CYCLE_GLYPHS[cycle.status || ''] || ' ';
        if (!groups.has(cycle.id)) {
          groups.set(cycle.id, {
            groupName: cycle.name,
            groupGlyph: glyph,
            groupKey: cycle.id,
            items: [],
          });
        }
        groups.get(cycle.id)!.items.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    const result = Array.from(groups.values());
    if (ungrouped.length > 0) {
      result.push({
        groupName: '(No cycle)',
        groupGlyph: ' ',
        groupKey: '__no_cycle__',
        items: ungrouped,
      });
    }
    return result;
  }

  if (groupBy === 'module') {
    const groups = new Map<string, GroupEntry>();
    const ungrouped: JsonArray = [];
    const itemIds = new Set(items.map((i) => i.id as string).filter(Boolean));

    const modules = await ctx.loadModules(projectId);
    const moduleMemberIds = await Promise.all(
      modules.map(async (m) => {
        const ids = await ctx.loadModuleIssueIds(projectId, m.id);
        return { mod: m, ids: new Set(ids) };
      }),
    );

    const itemToModule = new Map<string, string>();
    for (const { mod, ids } of moduleMemberIds) {
      for (const id of ids) {
        if (itemIds.has(id)) itemToModule.set(id, mod.id);
      }
    }

    for (const item of items) {
      const moduleId = itemToModule.get(item.id as string);
      const mod = moduleId ? modules.find((m) => m.id === moduleId) : undefined;
      if (mod) {
        const glyph = MODULE_GLYPHS[mod.status || ''] || ' ';
        if (!groups.has(mod.id)) {
          groups.set(mod.id, {
            groupName: mod.name,
            groupGlyph: glyph,
            groupKey: mod.id,
            items: [],
          });
        }
        groups.get(mod.id)!.items.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    const result = Array.from(groups.values());
    if (ungrouped.length > 0) {
      result.push({
        groupName: '(No module)',
        groupGlyph: 'x',
        groupKey: '__no_module__',
        items: ungrouped,
      });
    }
    return result;
  }

  if (groupBy === 'state') {
    const knownKeys = new Set(STATE_GROUP_ORDER);
    const stateMap = new Map<string, GroupEntry>();
    const noState: JsonArray = [];

    for (const item of items) {
      const state = item.state as JsonObject | undefined;
      const group = (state?.group as string) || '';
      if (!group) {
        noState.push(item);
        continue;
      }
      const key = group.toLowerCase();
      if (!stateMap.has(key)) {
        const glyph = STATUS_GLYPHS[key] || ' ';
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        const groupKey = knownKeys.has(key) ? key : `__unknown_${key}__`;
        stateMap.set(key, { groupName: name, groupGlyph: glyph, groupKey, items: [] });
      }
      stateMap.get(key)!.items.push(item);
    }

    const result: GroupEntry[] = [];
    result.push(...stateMap.values());

    if (noState.length > 0) {
      result.push({
        groupName: '(No state)',
        groupGlyph: ' ',
        groupKey: '__no_state__',
        items: noState,
      });
    }

    return result;
  }

  // groupBy === 'prio'
  const PRIORITY_HEADER_LABELS: Record<string, string> = {
    urgent: 'P0  Urgent',
    high: 'P1  High',
    medium: 'P2  Medium',
    low: 'P3  Low',
    none: 'P4  None',
  };

  const prioMap = new Map<string, GroupEntry>();
  const noPriority: JsonArray = [];

  for (const item of items) {
    const pri = String(item.priority || '').toLowerCase();
    if (!pri) {
      noPriority.push(item);
      continue;
    }
    if (!prioMap.has(pri)) {
      const name = PRIORITY_HEADER_LABELS[pri] || pri;
      prioMap.set(pri, { groupName: name, groupGlyph: '●', groupKey: pri, items: [] });
    }
    prioMap.get(pri)!.items.push(item);
  }

  const result: GroupEntry[] = [];
  result.push(...prioMap.values());

  if (noPriority.length > 0) {
    result.push({
      groupName: '(No priority)',
      groupGlyph: ' ',
      groupKey: '__no_priority__',
      items: noPriority,
    });
  }

  return result;
}

export async function handleRead(
  ctx: ResolverContext,
  args: ParsedArgs,
  defaultProject: string | null,
): Promise<void> {
  const { command, flags, positional } = args;
  const json = !!flags.json;

  switch (command) {
    // ── projects ──
    case 'projects': {
      const projects = await ctx.loadProjects();
      if (json) {
        printJson(projects);
      } else {
        process.stdout.write(formatProjects(projects) + '\n');
      }
      return;
    }

    // ── list ──
    case 'list': {
      const groupBy = validateGroupBy(flags);
      const projectId = await getProjectArg(ctx, flags, defaultProject);
      const project = await ctx.resolveProjectById(projectId);
      const { qs, plan } = await resolveFilters(ctx, flags, projectId);
      qs.expand = buildExpand(groupBy);

      // Filters are applied client-side. Fetch a full page so --limit still
      // has matches to slice; this is bounded by the API's max per_page (100).
      if (!isEmptyPlan(plan)) {
        const requested = qs.per_page ? Number(qs.per_page) : 0;
        if (!requested || requested < 100) qs.per_page = '100';
      }

      const items = await ctx.listWorkItems(projectId, qs);
      const filtered = applyClientFilters(items as JsonArray, plan);
      const finalItems = flags.limit ? filtered.slice(0, Number(flags.limit)) : filtered;

      if (json) {
        printJson({ project: project.identifier, items: finalItems });
      } else if (groupBy) {
        const groups = await buildGroups(ctx, finalItems, projectId, groupBy);
        process.stdout.write(formatGroupedWorkItems(groups, project.identifier, groupBy) + '\n');
      } else {
        process.stdout.write(formatWorkItemList(finalItems, project.identifier) + '\n');
      }
      return;
    }

    // ── show ──
    case 'show': {
      if (positional.length === 0) {
        throw new Error('Usage: pl show PROJ-42');
      }
      const format: OutputFormat = resolveShowFormat(
        flags.format as string | undefined,
        !!flags['no-color'],
      );

      const wi = await ctx.resolveWorkItem(positional[0]);
      const project = await ctx.resolveProjectById(wi.project_id);
      const comments = await ctx.listComments(wi.project_id, wi.id);
      const relations = await ctx.listRelations(wi.project_id, wi.id);

      // Enrich relations with human-readable related issue identifiers
      const enrichedRelations = await Promise.all(
        relations.map(async (rel) => {
          try {
            const relatedRaw = await ctx.getIssueRaw(wi.project_id, rel.related_issue_id);
            const displayId = await ctx.humanIssueId(relatedRaw);
            return {
              relation_type: rel.type,
              _display_id: displayId || '[unresolved issue id]',
              issue: relatedRaw,
            };
          } catch {
            return {
              relation_type: rel.type,
              _display_id: '[unresolved issue id]',
            };
          }
        }),
      );

      if (json) {
        printJson({ item: wi.raw, project, comments, relations: enrichedRelations });
      } else {
        process.stdout.write(
          formatWorkItemShow(wi.raw, wi.identifier, project, comments, enrichedRelations, format) +
            '\n',
        );
      }
      return;
    }

    // ── search ──
    case 'search': {
      if (positional.length === 0) {
        throw new Error('Usage: pl search "query" --project P');
      }
      const query = positional[0];
      const qs: Record<string, string> = { search: query };
      if (flags.limit) qs.limit = String(flags.limit);

      let project: { id: string; identifier: string } | null = null;
      if (flags.project) {
        const p = await ctx.resolveProject(flags.project as string);
        project = { id: p.id, identifier: p.identifier };
        qs.project_id = p.id;
      } else if (defaultProject) {
        const p = await ctx.resolveProject(defaultProject);
        project = { id: p.id, identifier: p.identifier };
        qs.project_id = p.id;
      } else if (!flags.workspace) {
        throw new Error(
          'No project specified. Use --project, set PLANE_DEFAULT_PROJECT, or pass --workspace to search across all projects.',
        );
      }

      const data = await ctx.client.get(ctx.client.workspacePath('work-items/search/'), qs);

      let items: JsonArray = [];
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.issues)) items = obj.issues as JsonArray;
      }

      if (json) {
        if (project) {
          printJson({ query, project: project.identifier, items });
        } else {
          printJson({ query, items });
        }
        return;
      }

      if (items.length === 0) {
        process.stdout.write(dim('(no results)') + '\n');
        return;
      }

      if (project) {
        for (const item of items) {
          const name = (item.name as string) || '';
          process.stdout.write(`${bold(`${project.identifier}-${item.sequence_id}`)}  ${name}\n`);
        }
      } else {
        for (const item of items) {
          const name = (item.name as string) || '';
          const projIdent = (item.project__identifier as string) || '';
          const seq = item.sequence_id as number;
          const id = projIdent && seq ? `${projIdent}-${seq}` : (item.id as string) || '?';
          process.stdout.write(`${bold(id)}  ${name}\n`);
        }
      }
      return;
    }

    // ── status ──
    case 'status': {
      if (flags.by) {
        throw new Error(
          "--by is not supported on 'status' yet. Use 'list', 'ready', or 'blocked' instead.",
        );
      }
      const projectId = await getProjectArg(ctx, flags, defaultProject);
      const qs: Record<string, string> = {
        per_page: '200',
        expand: 'state',
      };
      const items = await ctx.listWorkItems(projectId, qs);

      const byGroup: Record<string, number> = {};
      const byState: Record<string, number> = {};

      for (const item of items) {
        const state = item.state as Record<string, unknown> | undefined;
        const group = (state?.group as string) || 'unknown';
        const sname = (state?.name as string) || '?';
        byGroup[group] = (byGroup[group] || 0) + 1;
        byState[sname] = (byState[sname] || 0) + 1;
      }

      if (json) {
        printJson({
          by_group: byGroup,
          by_state: byState,
          total: items.length,
        });
      } else {
        process.stdout.write(formatStatus(byGroup, byState, items.length) + '\n');
      }
      return;
    }

    // ── ready ──
    case 'ready': {
      const groupBy = validateGroupBy(flags);
      const projectId = await getProjectArg(ctx, flags, defaultProject);
      const project = await ctx.resolveProjectById(projectId);
      const qs: Record<string, string> = {
        per_page: '200',
        expand: buildExpand(groupBy),
      };
      const items = await ctx.listWorkItems(projectId, qs);

      // Filter client-side: only backlog, unstarted, started
      const openItems = items.filter((item) => {
        const state = item.state as JsonObject | undefined;
        const group = state?.group as string;
        return group === 'backlog' || group === 'unstarted' || group === 'started';
      });

      // Check relations for each item
      const readyItems: JsonArray = [];
      for (const item of openItems) {
        const rels = await ctx.listRelations(projectId, item.id as string);
        const isBlocked = rels.some((r) => r.type === 'blocked_by');
        if (!isBlocked) {
          readyItems.push(item);
        }
      }

      if (json) {
        printJson({ project: project.identifier, items: readyItems });
      } else if (groupBy) {
        const groups = await buildGroups(ctx, readyItems, projectId, groupBy);
        process.stdout.write(formatGroupedWorkItems(groups, project.identifier, groupBy) + '\n');
      } else {
        process.stdout.write(formatWorkItemList(readyItems, project.identifier) + '\n');
      }
      return;
    }

    // ── blocked ──
    case 'blocked': {
      const groupBy = validateGroupBy(flags);
      const projectId = await getProjectArg(ctx, flags, defaultProject);
      const project = await ctx.resolveProjectById(projectId);
      const qs: Record<string, string> = {
        per_page: '200',
        expand: buildExpand(groupBy),
      };
      const items = await ctx.listWorkItems(projectId, qs);

      // Filter client-side: only backlog, unstarted, started
      const openItems = items.filter((item) => {
        const state = item.state as JsonObject | undefined;
        const group = state?.group as string;
        return group === 'backlog' || group === 'unstarted' || group === 'started';
      });

      const blockedItems: JsonArray = [];
      for (const item of openItems) {
        const rels = await ctx.listRelations(projectId, item.id as string);
        const isBlocked = rels.some((r) => r.type === 'blocked_by');
        if (isBlocked) {
          blockedItems.push(item);
        }
      }

      if (json) {
        printJson({ project: project.identifier, items: blockedItems });
      } else if (groupBy) {
        const groups = await buildGroups(ctx, blockedItems, projectId, groupBy);
        process.stdout.write(formatGroupedWorkItems(groups, project.identifier, groupBy) + '\n');
      } else {
        process.stdout.write(formatWorkItemList(blockedItems, project.identifier) + '\n');
      }
      return;
    }

    // ── states ──
    case 'states': {
      const projectId = await getProjectArg(ctx, flags, defaultProject);
      const project = await ctx.resolveProjectById(projectId);
      const states = await ctx.loadStates(projectId);
      if (json) printJson({ project: project.identifier, states });
      else process.stdout.write(formatStates(states) + '\n');
      return;
    }

    default:
      throw new Error(`Unknown read command: ${command}`);
  }
}
