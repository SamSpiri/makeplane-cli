import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson } from '../output.js';
import { formatModuleList, formatModuleShow } from '../formatters.js';
import { bodyToHtml } from '../html.js';
import { resolveProjectArg, resolveShowFormat } from './_helpers.js';

export async function handleModule(
  ctx: ResolverContext,
  args: ParsedArgs,
  defaultProject: string | null,
): Promise<void> {
  const { subcommand, flags, positional } = args;
  const json = !!flags.json;

  if (subcommand === 'show') {
    if (positional.length === 0) {
      throw new Error('Usage: pl module show "ModuleName" --project P');
    }
    const format = resolveShowFormat(flags.format as string | undefined, !!flags['no-color']);
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const project = await ctx.resolveProjectById(projectId);
    const mod = await ctx.resolveModule(projectId, positional[0]);
    const detail = await ctx.getModuleDetail(projectId, mod.id);
    const items = await ctx.loadModuleWorkItems(projectId, mod.id);

    if (json) {
      printJson({ project: project.identifier, module: detail, issues: items });
    } else {
      process.stdout.write(formatModuleShow(detail, items, project.identifier, format) + '\n');
    }
    return;
  }

  if (subcommand === 'list') {
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    if (json) {
      const data = await ctx.fetchRaw(`projects/${projectId}/modules/`, { per_page: '100' });
      printJson(data);
    } else {
      const modules = await ctx.loadModules(projectId);
      if (modules.length === 0) {
        process.stdout.write('(no modules)\n');
      } else {
        process.stdout.write(formatModuleList(modules) + '\n');
      }
    }
    return;
  }

  if (subcommand === 'create') {
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    if (!flags.title) throw new Error('--title is required for module create');
    const body: Record<string, unknown> = { name: flags.title };
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags['start-date']) body.start_date = flags['start-date'];
    if (flags['target-date']) body.target_date = flags['target-date'];
    if (flags.status) body.status = String(flags.status).replace(/_/g, '-');
    const data = (await ctx.client.post(
      ctx.client.workspacePath(`projects/${projectId}/modules/`),
      body,
    )) as Record<string, unknown>;
    ctx.invalidateModules(projectId);
    if (json) {
      printJson({ name: data.name, id: data.id });
    } else {
      process.stdout.write(`Created module "${data.name}"\n`);
    }
    return;
  }

  if (subcommand === 'update') {
    if (positional.length === 0)
      throw new Error('Usage: pl module update "ModuleName" --project P [flags]');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const mod = await ctx.resolveModule(projectId, positional[0]);
    const body: Record<string, unknown> = {};
    if (flags.title) body.name = flags.title;
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags['start-date']) body.start_date = flags['start-date'];
    if (flags['target-date']) body.target_date = flags['target-date'];
    if (flags.status) body.status = String(flags.status).replace(/_/g, '-');
    if (Object.keys(body).length === 0) throw new Error('No changes specified.');
    await ctx.client.patch(
      ctx.client.workspacePath(`projects/${projectId}/modules/${mod.id}/`),
      body,
    );
    ctx.invalidateModules(projectId);
    if (json) {
      printJson({ name: body.name || mod.name, updated: true });
    } else {
      process.stdout.write(`Updated module "${body.name || mod.name}"\n`);
    }
    return;
  }

  if (subcommand === 'delete') {
    if (positional.length === 0)
      throw new Error('Usage: pl module delete "ModuleName" --project P');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const mod = await ctx.resolveModule(projectId, positional[0]);
    await ctx.client.delete(ctx.client.workspacePath(`projects/${projectId}/modules/${mod.id}/`));
    ctx.invalidateModules(projectId);
    if (json) {
      printJson({ name: mod.name, deleted: true });
    } else {
      process.stdout.write(`Deleted module "${mod.name}"\n`);
    }
    return;
  }

  if (!subcommand) {
    throw new Error('Usage: pl module add-issue|remove-issue "ModuleName" PROJ-42 --project P');
  }
  if (positional.length < 2) {
    throw new Error('Usage: pl module add-issue|remove-issue "ModuleName" PROJ-42 --project P');
  }

  const projectId = await resolveProjectArg(ctx, flags, defaultProject);
  const mod = await ctx.resolveModule(projectId, positional[0]);
  const wi = await ctx.resolveWorkItem(positional[1]);

  if (subcommand === 'add-issue') {
    await ctx.client.post(
      ctx.client.workspacePath(`projects/${projectId}/modules/${mod.id}/module-issues/`),
      { issues: [wi.id] },
    );

    if (json) {
      printJson({
        identifier: wi.identifier,
        module: mod.name,
        added: true,
      });
    } else {
      process.stdout.write(`Added ${wi.identifier} to module "${mod.name}"\n`);
    }
  } else if (subcommand === 'remove-issue') {
    await ctx.client.delete(
      ctx.client.workspacePath(`projects/${projectId}/modules/${mod.id}/module-issues/${wi.id}/`),
    );

    if (json) {
      printJson({
        identifier: wi.identifier,
        module: mod.name,
        removed: true,
      });
    } else {
      process.stdout.write(`Removed ${wi.identifier} from module "${mod.name}"\n`);
    }
  }
}
