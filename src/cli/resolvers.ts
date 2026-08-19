import { PlaneClient } from '../plane-client.js';
import { CacheStore, CACHE_VERSION } from './cache.js';

type JsonObject = Record<string, unknown>;
type JsonArray = JsonObject[];

class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

export { ResolveError };

function asRecords(data: unknown): JsonArray {
  if (Array.isArray(data)) return data as JsonArray;
  if (data && typeof data === 'object') {
    const obj = data as JsonObject;
    if (Array.isArray(obj.results)) return obj.results as JsonArray;
  }
  return [];
}

function asRecord(data: unknown): JsonObject {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as JsonObject;
  }
  return {};
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function suggestSimilar(input: string, projects: ProjectInfo[]): ProjectInfo[] {
  const lc = input.toLowerCase();
  return projects
    .map((p) => ({ p, d: levenshtein(lc, p.identifier.toLowerCase()) }))
    .filter(({ d }) => d > 0 && d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ p }) => p);
}

function findProjectMatch(
  input: string,
  projects: ProjectInfo[],
): { kind: 'found'; project: ProjectInfo } | { kind: 'ambiguous'; matches: ProjectInfo[] } | null {
  const byId = projects.find((p) => p.identifier === input);
  if (byId) return { kind: 'found', project: byId };

  const byName = projects.filter((p) => p.name === input);
  if (byName.length === 1) return { kind: 'found', project: byName[0] };

  const lc = input.toLowerCase();
  const byNameCI = projects.filter((p) => p.name.toLowerCase() === lc);
  if (byNameCI.length === 1) return { kind: 'found', project: byNameCI[0] };

  const byUuid = projects.find((p) => p.id === input);
  if (byUuid) return { kind: 'found', project: byUuid };

  const matches = projects.filter(
    (p) => p.identifier.toLowerCase() === lc || p.name.toLowerCase() === lc,
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) return { kind: 'ambiguous', matches };
  return { kind: 'found', project: matches[0] };
}

export interface ProjectInfo {
  id: string;
  identifier: string;
  name: string;
}

export interface WorkItemInfo {
  id: string;
  project_id: string;
  sequence_id: number;
  identifier: string;
  name: string;
  priority: string | null;
  description_html: string | null;
  state: { id: string; name: string; group: string } | null;
  assigneeIds: string[];
  labelIds: string[];
  raw: JsonObject;
}

export interface StateInfo {
  id: string;
  name: string;
  group: string;
}

export interface LabelInfo {
  id: string;
  name: string;
}

export interface MemberInfo {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface CycleInfo {
  id: string;
  name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  total_issues: number | null;
}

export interface ModuleInfo {
  id: string;
  name: string;
  status: string | null;
  target_date: string | null;
  total_issues: number | null;
}

const WI_ID_RE = /^[A-Za-z0-9_]+-\d+$/;

export class ResolverContext {
  client: PlaneClient;
  private _cache: CacheStore | undefined;
  private _defaultProject: string | null = null;

  private _projects: Promise<ProjectInfo[]> | null = null;
  private _members: Promise<MemberInfo[]> | null = null;
  private _statesByProject = new Map<string, Promise<StateInfo[]>>();
  private _labelsByProject = new Map<string, Promise<LabelInfo[]>>();
  private _cyclesByProject = new Map<string, Promise<CycleInfo[]>>();
  private _modulesByProject = new Map<string, Promise<ModuleInfo[]>>();
  private _workItemMetaByProject = new Map<
    string,
    Promise<Record<string, { id: string; project_id: string }>>
  >();

  constructor(client: PlaneClient, cache?: CacheStore, defaultProject?: string | null) {
    this.client = client;
    this._cache = cache;
    this._defaultProject = defaultProject || null;
  }

  private _dbg(line: string): void {
    if (this.client.debug) process.stderr.write(`[debug] ${line}\n`);
  }

  private async fetch(path: string, qs?: Record<string, string>): Promise<unknown> {
    return this.client.get(this.client.workspacePath(path), qs);
  }

  async fetchRaw(path: string, qs?: Record<string, string>): Promise<unknown> {
    return this.fetch(path, qs);
  }

  private async paginate(
    path: string,
    baseQuery: Record<string, string> = {},
    pageSize = 100,
  ): Promise<JsonArray> {
    const all: JsonArray = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const qs: Record<string, string> = { ...baseQuery, per_page: String(pageSize) };
      if (cursor) qs.cursor = cursor;
      const data = await this.fetch(path, qs);
      all.push(...asRecords(data));

      hasMore = false;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const obj = data as Record<string, unknown>;
        if (obj.next_page_results && typeof obj.next_cursor === 'string') {
          cursor = obj.next_cursor;
          hasMore = true;
        }
      }
    }

    return all;
  }

  // ── Projects ──

  async invalidateProjects(): Promise<void> {
    this._projects = null;
    await this._cache?.clearWorkspaceSection('projects');
  }

  async loadProjects(): Promise<ProjectInfo[]> {
    if (this._projects) return this._projects;

    const promise = (async (): Promise<ProjectInfo[]> => {
      if (this._cache) {
        const disk = await this._cache.loadWorkspaceSection('projects');
        if (disk && Array.isArray(disk)) {
          this._dbg(`cache hit: projects (${disk.length} items)`);
          return disk as ProjectInfo[];
        }
      }

      const data = await this.fetch('projects/', { per_page: '200' });
      const items = asRecords(data).map((p) => ({
        id: p.id as string,
        identifier: (p.identifier as string) || '',
        name: (p.name as string) || '',
      }));

      this._cache?.saveWorkspaceSection('projects', items);
      return items;
    })();

    this._projects = promise;
    return promise;
  }

  async resolveProject(input: string): Promise<ProjectInfo> {
    let projects = await this.loadProjects();
    let match = findProjectMatch(input, projects);
    if (match === null) {
      await this.invalidateProjects();
      projects = await this.loadProjects();
      match = findProjectMatch(input, projects);
    }

    if (match === null) {
      const similar = suggestSimilar(input, projects);
      const hint =
        similar.length > 0
          ? ` Did you mean ${similar.map((p) => `"${p.identifier}"`).join(' or ')}?`
          : '';
      throw new ResolveError(
        `No project matching "${input}" found.${hint}\n` +
          `Available: ${projects.map((p) => p.identifier).join(', ')}`,
      );
    }

    if (match.kind === 'ambiguous') {
      throw new ResolveError(
        `Project "${input}" is ambiguous.\n` +
          `Matches:\n${match.matches.map((p) => `  - ${p.identifier} (${p.name})`).join('\n')}`,
      );
    }

    return match.project;
  }

  async resolveProjectById(id: string): Promise<ProjectInfo> {
    const projects = await this.loadProjects();
    const found = projects.find((p) => p.id === id);
    if (!found) throw new ResolveError(`Project with ID "${id}" not found.`);
    return found;
  }

  // ── Work Items ──

  private normalizeWorkItem(raw: JsonObject, identifier: string): WorkItemInfo {
    const state = raw.state as JsonObject | undefined;
    const assignees = (raw.assignees as JsonArray) || [];
    const labels = (raw.labels as JsonArray) || [];

    return {
      id: raw.id as string,
      project_id: (raw.project_id || raw.project) as string,
      sequence_id: raw.sequence_id as number,
      identifier,
      name: (raw.name as string) || '',
      priority: (raw.priority as string) || null,
      description_html: (raw.description_html as string) || null,
      state: state
        ? {
            id: state.id as string,
            name: (state.name as string) || '',
            group: (state.group as string) || '',
          }
        : null,
      assigneeIds: assignees.map((a: JsonObject) => a.id as string).filter(Boolean),
      labelIds: labels.map((l: JsonObject) => l.id as string).filter(Boolean),
      raw,
    };
  }

  async loadWorkItemMeta(
    projectId: string,
    identifier: string,
  ): Promise<{ id: string; project_id: string } | null> {
    const existing = this._workItemMetaByProject.get(projectId);
    if (existing) return existing.then((map) => map[identifier] ?? null);

    const promise = (async (): Promise<Record<string, { id: string; project_id: string }>> => {
      if (this._cache) {
        const disk = await this._cache.loadProjectNamespace<
          Record<string, { id: string; project_id: string }>
        >(projectId, 'items');
        if (disk) {
          this._dbg(`cache hit: work-item meta (${Object.keys(disk).length} items)`);
          return disk;
        }
      }
      return {};
    })();

    this._workItemMetaByProject.set(projectId, promise);
    return promise.then((map) => map[identifier] ?? null);
  }

  async resolveWorkItem(input: string): Promise<WorkItemInfo> {
    if (this._defaultProject && /^\d+$/.test(input)) {
      input = `${this._defaultProject}-${input}`;
    }
    if (!WI_ID_RE.test(input)) {
      throw new ResolveError(`Invalid work item identifier "${input}". Expected format: PROJ-42`);
    }

    let data: unknown;
    let resolvedProjectId: string | undefined;

    // Try to parse project prefix and use meta cache for a UUID-based fetch
    const prefix = input.replace(/-\d+$/, '');
    if (prefix && prefix !== input) {
      try {
        const project = await this.resolveProject(prefix);
        resolvedProjectId = project.id;
        const meta = await this.loadWorkItemMeta(project.id, input);
        if (meta) {
          try {
            data = await this.fetch(`projects/${project.id}/issues/${meta.id}/`, {
              expand: 'state',
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('404')) throw err;
          }
        }
      } catch (err) {
        if (err instanceof ResolveError) throw err;
        // Other errors (network, 5xx) — fall through to identifier fetch
      }
    }

    if (!data) {
      try {
        data = await this.fetch(`issues/${input}/`, { expand: 'state' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404')) {
          throw new ResolveError(`Work item "${input}" not found.`);
        }
        throw err;
      }
    }

    const item = asRecord(data);

    if (!item.id) {
      throw new ResolveError(`Work item "${input}" not found.`);
    }

    const result = this.normalizeWorkItem(item, input);

    // Write mapping to meta cache for future lookups
    const pid = resolvedProjectId || (result.project_id as string);
    if (pid && this._cache) {
      this._workItemMetaByProject.get(pid)?.then((map) => {
        map[input] = { id: result.id, project_id: pid };
      });
      this._cache.mutateItem(pid, input, { id: result.id, project_id: pid });
    }

    return result;
  }

  async getIssueRaw(projectId: string, workItemId: string): Promise<JsonObject> {
    const data = await this.fetch(`projects/${projectId}/issues/${workItemId}/`, {
      expand: 'state',
    });
    return asRecord(data);
  }

  async listWorkItems(projectId: string, filters: Record<string, string>): Promise<JsonArray> {
    const qs: Record<string, string> = {
      ...filters,
    };
    if (!qs.expand) {
      qs.expand = 'state';
    }
    const data = await this.fetch(`projects/${projectId}/issues/`, qs);
    return asRecords(data);
  }

  // ── Human identifier helpers ──

  async humanIssueId(item: JsonObject): Promise<string | null> {
    const seq = item.sequence_id as number | undefined;
    if (seq == null) return null;

    // a. project_identifier or project__identifier field directly on item
    const directIdent =
      (item.project_identifier as string) || (item.project__identifier as string) || undefined;
    if (directIdent) return `${directIdent}-${seq}`;

    // b. nested project object
    const project = item.project as JsonObject | undefined;
    if (project?.identifier) return `${project.identifier}-${seq}`;

    // c. resolve by project_id (or project, as Plane API uses either field)
    const pid = (item.project_id || item.project) as string | undefined;
    if (!pid) return null;

    try {
      const proj = await this.resolveProjectById(pid);
      return `${proj.identifier}-${seq}`;
    } catch {
      return null;
    }
  }

  // ── States ──

  loadStates(projectId: string): Promise<StateInfo[]> {
    const existing = this._statesByProject.get(projectId);
    if (existing) return existing;

    const promise = (async (): Promise<StateInfo[]> => {
      if (this._cache) {
        const disk = await this._cache.loadProjectNamespace<StateInfo[]>(projectId, 'states');
        if (disk && Array.isArray(disk)) {
          this._dbg(`cache hit: states (${disk.length} items)`);
          return disk;
        }
      }

      const data = await this.fetch(`projects/${projectId}/states/`, { per_page: '200' });
      const items = asRecords(data).map((s) => ({
        id: s.id as string,
        name: (s.name as string) || '',
        group: (s.group as string) || '',
      }));

      this._cache?.saveProjectNamespace(projectId, 'states', {
        version: CACHE_VERSION,
        updated_at: new Date().toISOString(),
        items,
      });
      return items;
    })();

    this._statesByProject.set(projectId, promise);
    return promise;
  }

  async resolveState(projectId: string, input: string): Promise<StateInfo> {
    const states = await this.loadStates(projectId);

    // Exact / case-insensitive name match (the common path).
    const byName = states.filter((s) => s.name === input);
    if (byName.length === 1) return byName[0];
    const lc = input.toLowerCase();
    const byCI = states.filter((s) => s.name.toLowerCase() === lc);
    if (byCI.length === 1) return byCI[0];

    // Fallback: input may be a state GROUP (backlog/unstarted/started/
    // completed/cancelled). If that group has exactly one state, use it.
    // Lets users say `--state unstarted` instead of remembering the
    // human-chosen state name sitting in that group.
    if (byCI.length === 0) {
      const groupMatch = states.filter((s) => s.group.toLowerCase() === lc);
      if (groupMatch.length === 1) return groupMatch[0];
      if (groupMatch.length > 1) {
        throw new ResolveError(
          `State group "${input}" has multiple states. ` +
            `Use one of: ${groupMatch.map((s) => s.name).join(', ')}.\n` +
            `Try: pl states --project <project>`,
        );
      }
    }

    // Fall through to matchByName for the canonical error + hint.
    return this.matchByName(states, input, 'state', 'states');
  }

  async resolveCompletedState(projectId: string): Promise<StateInfo> {
    const states = await this.loadStates(projectId);
    const completed = states.filter((s) => s.group === 'completed');
    if (completed.length === 0) {
      throw new ResolveError(
        `No completed state found in this project. Define one in Plane first.`,
      );
    }
    if (completed.length > 1) {
      throw new ResolveError(
        `Multiple completed states found. Use "pl edit PROJ-42 --state <name>" to pick one.\n` +
          `Completed states: ${completed.map((s) => s.name).join(', ')}`,
      );
    }
    return completed[0];
  }

  async resolveUnstartedState(projectId: string): Promise<StateInfo> {
    const states = await this.loadStates(projectId);
    const candidates = states.filter((s) => s.group === 'unstarted' || s.group === 'backlog');
    if (candidates.length === 0) {
      throw new ResolveError(`No unstarted or backlog state found in this project.`);
    }
    // Prefer unstarted over backlog
    const unstarted = candidates.filter((s) => s.group === 'unstarted');
    if (unstarted.length === 1) return unstarted[0];
    if (unstarted.length > 1) {
      throw new ResolveError(
        `Multiple unstarted states found. Use "pl reopen PROJ-42 --state <name>".\n` +
          `Unstarted states: ${unstarted.map((s) => s.name).join(', ')}`,
      );
    }
    // Fall back to backlog
    const backlog = candidates.filter((s) => s.group === 'backlog');
    if (backlog.length === 1) return backlog[0];
    if (backlog.length > 1) {
      throw new ResolveError(
        `Multiple backlog states found. Use "pl reopen PROJ-42 --state <name>".\n` +
          `Backlog states: ${backlog.map((s) => s.name).join(', ')}`,
      );
    }
    return candidates[0];
  }

  // ── Labels ──

  loadLabels(projectId: string): Promise<LabelInfo[]> {
    const existing = this._labelsByProject.get(projectId);
    if (existing) return existing;

    const promise = (async (): Promise<LabelInfo[]> => {
      if (this._cache) {
        const disk = await this._cache.loadProjectNamespace<LabelInfo[]>(projectId, 'labels');
        if (disk && Array.isArray(disk)) {
          this._dbg(`cache hit: labels (${disk.length} items)`);
          return disk;
        }
      }

      const data = await this.fetch(`projects/${projectId}/labels/`, { per_page: '200' });
      const items = asRecords(data).map((l) => ({
        id: l.id as string,
        name: (l.name as string) || '',
      }));

      this._cache?.saveProjectNamespace(projectId, 'labels', {
        version: CACHE_VERSION,
        updated_at: new Date().toISOString(),
        items,
      });
      return items;
    })();

    this._labelsByProject.set(projectId, promise);
    return promise;
  }

  async resolveLabel(projectId: string, input: string): Promise<LabelInfo> {
    const labels = await this.loadLabels(projectId);
    return this.matchByName(labels, input, 'label', '');
  }

  // ── Members ──

  loadMembers(): Promise<MemberInfo[]> {
    if (this._members) return this._members;

    const promise = (async (): Promise<MemberInfo[]> => {
      if (this._cache) {
        const disk = await this._cache.loadWorkspaceSection('members');
        if (disk && Array.isArray(disk)) {
          this._dbg(`cache hit: members (${disk.length} items)`);
          return disk as MemberInfo[];
        }
      }

      const data = await this.fetch('members/', { per_page: '200' });
      const items = asRecords(data).map((m) => ({
        id: m.id as string,
        email: (m.email as string) || null,
        display_name: (m.display_name as string) || null,
      }));

      this._cache?.saveWorkspaceSection('members', items);
      return items;
    })();

    this._members = promise;
    return promise;
  }

  async resolveMember(input: string): Promise<MemberInfo> {
    const members = await this.loadMembers();

    if (input.includes('@')) {
      const byEmail = members.find((m) => m.email === input);
      if (byEmail) return byEmail;
      throw new ResolveError(
        `No member with email "${input}" found.\n` +
          `Emails: ${members
            .map((m) => m.email)
            .filter(Boolean)
            .join(', ')}`,
      );
    }

    const byDisplay = members.filter((m) => m.display_name === input);
    if (byDisplay.length === 1) return byDisplay[0];

    const lc = input.toLowerCase();
    const byCI = members.filter((m) => (m.display_name || '').toLowerCase() === lc);
    if (byCI.length === 1) return byCI[0];

    if (byCI.length > 1) {
      throw new ResolveError(
        `Member "${input}" is ambiguous.\n` +
          `Matches:\n${byCI.map((m) => `  - ${m.display_name} (${m.email})`).join('\n')}`,
      );
    }

    throw new ResolveError(
      `No member matching "${input}" found.\n` +
        `Members: ${members
          .map((m) => m.display_name || m.email)
          .filter(Boolean)
          .join(', ')}`,
    );
  }

  // ── Cycles ──

  // Cycles and modules are deliberately not cached on disk: they churn too
  // often (sprint starts/ends, modules open/close) and a stale list misleads
  // more than it helps. The in-memory promise dedup above is a per-invocation
  // memo only.
  loadCycles(projectId: string): Promise<CycleInfo[]> {
    const existing = this._cyclesByProject.get(projectId);
    if (existing) return existing;

    const promise = (async (): Promise<CycleInfo[]> => {
      const data = await this.fetch(`projects/${projectId}/cycles/`, { per_page: '200' });
      return asRecords(data).map((c) => ({
        id: c.id as string,
        name: (c.name as string) || '',
        status: (c.status as string) || null,
        start_date: (c.start_date as string) || null,
        end_date: (c.end_date as string) || null,
        total_issues: typeof c.total_issues === 'number' ? c.total_issues : null,
      }));
    })();

    this._cyclesByProject.set(projectId, promise);
    return promise;
  }

  async resolveCycle(projectId: string, input: string): Promise<CycleInfo> {
    const cycles = await this.loadCycles(projectId);
    return this.matchByName(cycles, input, 'cycle', 'cycle list');
  }

  async getCycleDetail(projectId: string, cycleId: string): Promise<JsonObject> {
    const data = await this.fetch(`projects/${projectId}/cycles/${cycleId}/`);
    return asRecord(data);
  }

  async loadCycleIssueIds(projectId: string, cycleId: string): Promise<string[]> {
    const data = await this.fetch(`projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      per_page: '200',
    });
    return asRecords(data)
      .map((i) => i.id as string)
      .filter(Boolean);
  }

  async loadCycleWorkItems(projectId: string, cycleId: string): Promise<JsonArray> {
    return this.paginate(`projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      expand: 'state',
    });
  }

  // ── Modules ──

  loadModules(projectId: string): Promise<ModuleInfo[]> {
    const existing = this._modulesByProject.get(projectId);
    if (existing) return existing;

    const promise = (async (): Promise<ModuleInfo[]> => {
      const rawData = await this.fetch(`projects/${projectId}/modules/`, { per_page: '200' });
      return asRecords(rawData).map((m) => {
        const rawStatus = (m.status as string) || null;
        return {
          id: m.id as string,
          name: (m.name as string) || '',
          status: rawStatus ? rawStatus.replace(/-/g, '_') : null,
          target_date: (m.target_date as string) || null,
          total_issues: typeof m.total_issues === 'number' ? m.total_issues : null,
        };
      });
    })();

    this._modulesByProject.set(projectId, promise);
    return promise;
  }

  async resolveModule(projectId: string, input: string): Promise<ModuleInfo> {
    const modules = await this.loadModules(projectId);
    return this.matchByName(modules, input, 'module', 'module list');
  }

  async getModuleDetail(projectId: string, moduleId: string): Promise<JsonObject> {
    const data = await this.fetch(`projects/${projectId}/modules/${moduleId}/`);
    return asRecord(data);
  }

  async loadModuleIssueIds(projectId: string, moduleId: string): Promise<string[]> {
    const data = await this.fetch(`projects/${projectId}/modules/${moduleId}/module-issues/`, {
      per_page: '200',
    });
    return asRecords(data)
      .map((i) => i.id as string)
      .filter(Boolean);
  }

  async loadModuleWorkItems(projectId: string, moduleId: string): Promise<JsonArray> {
    return this.paginate(`projects/${projectId}/modules/${moduleId}/module-issues/`, {
      expand: 'state',
    });
  }

  invalidateCycles(projectId: string): void {
    this._cyclesByProject.delete(projectId);
  }

  invalidateModules(projectId: string): void {
    this._modulesByProject.delete(projectId);
  }

  invalidateLabels(projectId: string): void {
    this._labelsByProject.delete(projectId);
    this._cache?.clear('labels', projectId);
  }

  // ── Relations ──

  async listRelations(
    projectId: string,
    workItemId: string,
  ): Promise<
    { type: 'blocked_by' | 'blocks' | 'duplicate' | 'relates_to'; related_issue_id: string }[]
  > {
    const TYPE_MAP: Record<string, 'blocked_by' | 'blocks' | 'duplicate' | 'relates_to'> = {
      blocking: 'blocks',
      blocked_by: 'blocked_by',
      duplicate: 'duplicate',
      relates_to: 'relates_to',
    };
    const SUPPORTED = new Set(['blocking', 'blocked_by', 'duplicate', 'relates_to']);

    const data = await this.fetch(`projects/${projectId}/issues/${workItemId}/relations/`);
    const result: {
      type: 'blocked_by' | 'blocks' | 'duplicate' | 'relates_to';
      related_issue_id: string;
    }[] = [];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;
      for (const [rawType, ids] of Object.entries(obj)) {
        if (!SUPPORTED.has(rawType)) continue;
        const normalizedType = TYPE_MAP[rawType];
        if (!normalizedType) continue;
        if (Array.isArray(ids)) {
          for (const id of ids) {
            if (typeof id === 'string') {
              result.push({ type: normalizedType, related_issue_id: id });
            }
          }
        }
      }
    }
    return result;
  }

  async listComments(projectId: string, workItemId: string): Promise<JsonArray> {
    const data = await this.fetch(`projects/${projectId}/issues/${workItemId}/comments/`, {
      expand: 'actor',
    });
    return asRecords(data);
  }

  // ── Helpers ──

  private matchByName<T extends { id: string; name: string }>(
    items: T[],
    input: string,
    kind: string,
    listCommand: string,
  ): T {
    const byName = items.filter((item) => item.name === input);
    if (byName.length === 1) return byName[0];

    const lc = input.toLowerCase();
    const byCI = items.filter((item) => item.name.toLowerCase() === lc);
    if (byCI.length === 1) return byCI[0];

    if (byCI.length > 1) {
      throw new ResolveError(
        `${kind.charAt(0).toUpperCase() + kind.slice(1)} "${input}" is ambiguous.\n` +
          `Matches:\n${byCI.map((item) => `  - ${item.name}`).join('\n')}`,
      );
    }

    const names = items.map((item) => item.name).filter(Boolean);
    const hint = listCommand ? `Try: pl ${listCommand} --project <project>\n` : '';
    throw new ResolveError(
      `No ${kind} named "${input}" found in this project.\n` +
        hint +
        (names.length > 0 ? `Available: ${names.join(', ')}` : ''),
    );
  }
}
