import { readFile, writeFile, rename, mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ParsedArgs } from './parser.js';
import { printJson } from './output.js';

export const CACHE_VERSION = 1;

const WARNED = new Set<string>();

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errCode(err: unknown): string {
  if (err instanceof Error && 'code' in err) {
    return (err as { code: string }).code || 'unknown';
  }
  return 'unknown';
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === 'ENOENT';
}

function warnOnce(dedupKey: string, text: string): void {
  if (WARNED.has(dedupKey)) return;
  WARNED.add(dedupKey);
  process.stderr.write(`Warning: ${text}\n`);
}

interface WorkspaceData {
  version: number;
  updated_at: string;
  projects: unknown[];
  members: unknown[];
}

export interface CacheSummaryInfo {
  baseDir: string;
  workspaceFile: { size: number } | null;
  projects: { id: string; files: { name: string; size: number }[] }[];
}

export class CacheStore {
  private _baseDir: string;
  private _workspacePath: string;
  private _fileWriteQueues = new Map<string, Promise<unknown>>();

  constructor(opts?: { baseDir?: string }) {
    const root = opts?.baseDir || process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    this._baseDir = path.join(root, 'plane-pl-cli');
    this._workspacePath = path.join(this._baseDir, 'workspace.json');
  }

  private async _ensureDir(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      warnOnce(`mkdir:${errCode(err)}`, `cannot create cache directory ${dir}: ${errMsg(err)}`);
    }
  }

  private async _readJSON<T>(filePath: string, label: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if (isENOENT(err)) return null;
      if (err instanceof SyntaxError) {
        warnOnce(`read:${label}:parse`, `cannot parse cache ${filePath}: ${errMsg(err)}`);
      } else {
        warnOnce(`read:${label}:${errCode(err)}`, `cannot read cache ${filePath}: ${errMsg(err)}`);
      }
      return null;
    }
  }

  private async _atomicWrite(filePath: string, label: string, data: unknown): Promise<void> {
    const tmpPath = filePath + '.tmp';
    try {
      await writeFile(tmpPath, JSON.stringify(data), 'utf-8');
      await rename(tmpPath, filePath);
    } catch (err) {
      warnOnce(`write:${label}:${errCode(err)}`, `cannot write cache ${filePath}: ${errMsg(err)}`);
    }
  }

  private enqueueWrite<T>(filePath: string, op: () => Promise<T>): Promise<T> {
    const prev = this._fileWriteQueues.get(filePath) ?? Promise.resolve();
    const next = prev.then(() => op());
    const tail = next.catch(() => {});
    this._fileWriteQueues.set(filePath, tail);
    void next.finally(() => {
      if (this._fileWriteQueues.get(filePath) === tail) {
        this._fileWriteQueues.delete(filePath);
      }
    });
    return next;
  }

  // ── workspace.json ──

  private async _loadWorkspace(): Promise<WorkspaceData | null> {
    return this._readJSON<WorkspaceData>(this._workspacePath, 'workspace');
  }

  private async _saveWorkspaceSectionImpl<K extends 'projects' | 'members'>(
    section: K,
    items: unknown[],
  ): Promise<void> {
    await this._ensureDir(this._baseDir);
    const current = await this._loadWorkspace();
    const data: WorkspaceData =
      current && current.version === CACHE_VERSION
        ? { ...current, updated_at: new Date().toISOString() }
        : {
            version: CACHE_VERSION,
            updated_at: new Date().toISOString(),
            projects: [],
            members: [],
          };
    data[section] = items;
    await this._atomicWrite(this._workspacePath, `workspace:${section}`, data);
  }

  async loadWorkspaceSection<K extends 'projects' | 'members'>(
    section: K,
  ): Promise<unknown[] | null> {
    const ws = await this._loadWorkspace();
    if (!ws || ws.version !== CACHE_VERSION) return null;
    return ws[section] as unknown[];
  }

  async saveWorkspaceSection<K extends 'projects' | 'members'>(
    section: K,
    items: unknown[],
  ): Promise<void> {
    return this.enqueueWrite(this._workspacePath, () =>
      this._saveWorkspaceSectionImpl(section, items),
    );
  }

  async clearWorkspaceSection(section: 'projects' | 'members'): Promise<void> {
    return this.enqueueWrite(this._workspacePath, async () => {
      try {
        await this._ensureDir(this._baseDir);
        const current = await this._loadWorkspace();
        if (!current || current.version !== CACHE_VERSION) return;
        const next = { ...current };
        delete (next as Record<string, unknown>)[section];
        next.updated_at = new Date().toISOString();
        await this._atomicWrite(this._workspacePath, `workspace:${section}`, next);
      } catch (err) {
        warnOnce(
          `clear:${section}:${errCode(err)}`,
          `cannot clear workspace section ${section}: ${errMsg(err)}`,
        );
      }
    });
  }

  // ── per-project namespace files ──

  private _projectDir(projectId: string): string {
    return path.join(this._baseDir, projectId);
  }

  private _projectFilePath(projectId: string, namespace: string): string {
    return path.join(this._projectDir(projectId), `${namespace}.json`);
  }

  async loadProjectNamespace<T>(projectId: string, namespace: string): Promise<T | null> {
    const data = await this._readJSON<{ version: number; items: T }>(
      this._projectFilePath(projectId, namespace),
      namespace,
    );
    if (!data || data.version !== CACHE_VERSION) return null;
    return data.items;
  }

  async saveProjectNamespace(projectId: string, namespace: string, data: unknown): Promise<void> {
    const filePath = this._projectFilePath(projectId, namespace);
    return this.enqueueWrite(filePath, async () => {
      try {
        await this._ensureDir(this._projectDir(projectId));
        await this._atomicWrite(filePath, namespace, data);
      } catch (err) {
        warnOnce(
          `${namespace}:${errCode(err)}`,
          `cannot save cache for project ${projectId}/${namespace}: ${errMsg(err)}`,
        );
      }
    });
  }

  async mutateItem(
    projectId: string,
    identifier: string,
    meta: { id: string; project_id: string },
  ): Promise<void> {
    const filePath = this._projectFilePath(projectId, 'items');
    return this.enqueueWrite(filePath, async () => {
      try {
        await this._ensureDir(this._projectDir(projectId));
        const current = await this._readJSON<{
          version: number;
          updated_at: string;
          items: Record<string, unknown>;
        }>(filePath, 'items');
        const items: Record<string, unknown> =
          current && current.version === CACHE_VERSION ? { ...current.items } : {};
        items[identifier] = meta;
        await this._atomicWrite(filePath, 'items', {
          version: CACHE_VERSION,
          updated_at: new Date().toISOString(),
          items,
        });
      } catch (err) {
        warnOnce(
          `items:${errCode(err)}`,
          `cannot save item cache for ${projectId}: ${errMsg(err)}`,
        );
      }
    });
  }

  // ── clear ──

  async clear(namespace?: string, projectId?: string): Promise<boolean> {
    try {
      if (projectId) {
        if (namespace) {
          const fp = this._projectFilePath(projectId, namespace);
          await rm(fp, { force: true });
        } else {
          await rm(this._projectDir(projectId), { recursive: true, force: true });
        }
        return true;
      } else if (namespace) {
        return false;
      } else {
        await rm(this._baseDir, { recursive: true, force: true });
        return true;
      }
    } catch (err) {
      warnOnce(`clear:${errCode(err)}`, `cannot clear cache: ${errMsg(err)}`);
      return false;
    }
  }

  // ── summary ──

  async summary(): Promise<CacheSummaryInfo> {
    const result: CacheSummaryInfo = { baseDir: this._baseDir, workspaceFile: null, projects: [] };

    try {
      const wsStat = await stat(this._workspacePath);
      result.workspaceFile = { size: wsStat.size };
    } catch {
      /* workspace file may not exist */
    }

    try {
      const entries = await readdir(this._baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectDir = path.join(this._baseDir, entry.name);
        const files: { name: string; size: number }[] = [];
        try {
          const fileEntries = await readdir(projectDir, { withFileTypes: true });
          for (const fe of fileEntries) {
            if (!fe.isFile() || fe.name.endsWith('.tmp')) continue;
            try {
              const s = await stat(path.join(projectDir, fe.name));
              files.push({ name: fe.name, size: s.size });
            } catch {
              /* unreadable file */
            }
          }
        } catch {
          /* unreadable project dir */
        }
        result.projects.push({ id: entry.name, files });
      }
    } catch (err) {
      if (!isENOENT(err)) {
        warnOnce(
          `summary:readdir:${errCode(err)}`,
          `cannot read cache directory ${this._baseDir}: ${errMsg(err)}`,
        );
      }
    }

    return result;
  }
}

// ── CLI handler ──

export async function handleCache(
  args: ParsedArgs,
  cache: CacheStore,
  resolveProjectId?: (input: string) => Promise<string>,
): Promise<void> {
  const json = !!args.flags.json;

  if (args.subcommand === 'show') {
    const summary = await cache.summary();
    if (json) {
      printJson(summary);
      return;
    }

    const lines: string[] = [`Cache: ${summary.baseDir}`];

    if (summary.workspaceFile) {
      lines.push(`  workspace.json  (${summary.workspaceFile.size} bytes)`);
    } else {
      lines.push(`  (no workspace.json)`);
    }

    if (summary.projects.length === 0) {
      lines.push(`  (no project caches)`);
    } else {
      for (const proj of summary.projects) {
        lines.push(`  ${proj.id}/`);
        for (const f of proj.files) {
          lines.push(`    ${f.name}  (${f.size} bytes)`);
        }
      }
    }

    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  if (args.subcommand === 'clear') {
    let projectId: string | undefined;
    if (args.flags.project) {
      if (!resolveProjectId) {
        process.stderr.write(
          'Warning: cannot resolve project for cache clear (no resolver available). Use project UUID directly.\n',
        );
        return;
      }
      try {
        projectId = await resolveProjectId(args.flags.project as string);
      } catch (err) {
        process.stderr.write(`Error: ${errMsg(err)}\n`);
        process.exit(1);
      }
    }

    await cache.clear(undefined, projectId);
    if (projectId) {
      process.stdout.write(`Cache cleared for project ${args.flags.project}.\n`);
    } else {
      process.stdout.write('Cache cleared.\n');
    }
    return;
  }

  process.stderr.write('Usage: pl cache show|clear [--project <id>]\n');
  process.exit(1);
}
