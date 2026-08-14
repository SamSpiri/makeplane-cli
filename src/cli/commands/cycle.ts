import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson } from '../output.js';
import { formatCycleList, formatCycleShow } from '../formatters.js';
import { bodyToHtml } from '../html.js';
import { resolveProjectArg, resolveShowFormat } from './_helpers.js';

function normalizeCycleDate(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return trimmed;
  }
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/);
  if (m) {
    const date = m[1];
    const time = m[2] || '00:00';
    return `${date}T${time}:00Z`;
  }
  throw new Error(`Invalid date "${input}". Use YYYY-MM-DD or YYYY-MM-DD HH:MM.`);
}

export async function handleCycle(
  ctx: ResolverContext,
  args: ParsedArgs,
  defaultProject: string | null,
): Promise<void> {
  const { subcommand, flags, positional } = args;
  const json = !!flags.json;

  if (subcommand === 'show') {
    if (positional.length === 0) {
      throw new Error('Usage: pl cycle show "CycleName" --project P');
    }
    const format = resolveShowFormat(flags.format as string | undefined, !!flags['no-color']);
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const project = await ctx.resolveProjectById(projectId);
    const cycle = await ctx.resolveCycle(projectId, positional[0]);
    const detail = await ctx.getCycleDetail(projectId, cycle.id);
    const items = await ctx.loadCycleWorkItems(projectId, cycle.id);

    if (json) {
      printJson({ project: project.identifier, cycle: detail, issues: items });
    } else {
      process.stdout.write(formatCycleShow(detail, items, project.identifier, format) + '\n');
    }
    return;
  }

  if (subcommand === 'list') {
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    if (json) {
      const data = await ctx.fetchRaw(`projects/${projectId}/cycles/`, { per_page: '100' });
      printJson(data);
    } else {
      const cycles = await ctx.loadCycles(projectId);
      if (cycles.length === 0) {
        process.stdout.write('(no cycles)\n');
      } else {
        process.stdout.write(formatCycleList(cycles) + '\n');
      }
    }
    return;
  }

  if (subcommand === 'create') {
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    if (!flags.title) throw new Error('--title is required for cycle create');
    const body: Record<string, unknown> = { name: flags.title };
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags['start-date']) body.start_date = normalizeCycleDate(flags['start-date'] as string);
    if (flags['end-date']) body.end_date = normalizeCycleDate(flags['end-date'] as string);
    const data = (await ctx.client.post(
      ctx.client.workspacePath(`projects/${projectId}/cycles/`),
      body,
    )) as Record<string, unknown>;
    ctx.invalidateCycles(projectId);
    if (json) {
      printJson({ name: data.name, id: data.id });
    } else {
      process.stdout.write(`Created cycle "${data.name}"\n`);
    }
    return;
  }

  if (subcommand === 'update') {
    if (positional.length === 0)
      throw new Error('Usage: pl cycle update "CycleName" --project P [flags]');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const cycle = await ctx.resolveCycle(projectId, positional[0]);
    const body: Record<string, unknown> = {};
    if (flags.title) body.name = flags.title;
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags['start-date']) body.start_date = normalizeCycleDate(flags['start-date'] as string);
    if (flags['end-date']) body.end_date = normalizeCycleDate(flags['end-date'] as string);
    if (Object.keys(body).length === 0) throw new Error('No changes specified.');
    await ctx.client.patch(
      ctx.client.workspacePath(`projects/${projectId}/cycles/${cycle.id}/`),
      body,
    );
    ctx.invalidateCycles(projectId);
    if (json) {
      printJson({ name: body.name || cycle.name, updated: true });
    } else {
      process.stdout.write(`Updated cycle "${body.name || cycle.name}"\n`);
    }
    return;
  }

  if (subcommand === 'delete') {
    if (positional.length === 0) throw new Error('Usage: pl cycle delete "CycleName" --project P');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const cycle = await ctx.resolveCycle(projectId, positional[0]);
    await ctx.client.delete(ctx.client.workspacePath(`projects/${projectId}/cycles/${cycle.id}/`));
    ctx.invalidateCycles(projectId);
    if (json) {
      printJson({ name: cycle.name, deleted: true });
    } else {
      process.stdout.write(`Deleted cycle "${cycle.name}"\n`);
    }
    return;
  }

  if (!subcommand) {
    throw new Error('Usage: pl cycle add-issue|remove-issue "CycleName" PROJ-42 --project P');
  }
  if (positional.length < 2) {
    throw new Error('Usage: pl cycle add-issue|remove-issue "CycleName" PROJ-42 --project P');
  }

  const projectId = await resolveProjectArg(ctx, flags, defaultProject);
  const cycle = await ctx.resolveCycle(projectId, positional[0]);
  const wi = await ctx.resolveWorkItem(positional[1]);

  if (subcommand === 'add-issue') {
    await ctx.client.post(
      ctx.client.workspacePath(`projects/${projectId}/cycles/${cycle.id}/cycle-issues/`),
      { issue_ids: [wi.id] },
    );

    if (json) {
      printJson({
        identifier: wi.identifier,
        cycle: cycle.name,
        added: true,
      });
    } else {
      process.stdout.write(`Added ${wi.identifier} to cycle "${cycle.name}"\n`);
    }
  } else if (subcommand === 'remove-issue') {
    await ctx.client.delete(
      ctx.client.workspacePath(`projects/${projectId}/cycles/${cycle.id}/cycle-issues/${wi.id}/`),
    );

    if (json) {
      printJson({
        identifier: wi.identifier,
        cycle: cycle.name,
        removed: true,
      });
    } else {
      process.stdout.write(`Removed ${wi.identifier} from cycle "${cycle.name}"\n`);
    }
  }
}
