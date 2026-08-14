import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson } from '../output.js';
import { formatLabelList } from '../formatters.js';
import { resolveProjectArg } from './_helpers.js';

export async function handleLabel(
  ctx: ResolverContext,
  args: ParsedArgs,
  defaultProject: string | null,
): Promise<void> {
  const { subcommand, flags, positional } = args;
  const json = !!flags.json;

  if (subcommand === 'list') {
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    if (json) {
      const data = await ctx.fetchRaw(`projects/${projectId}/labels/`, { per_page: '100' });
      printJson(data);
    } else {
      const labels = await ctx.loadLabels(projectId);
      if (labels.length === 0) {
        process.stdout.write('(no labels)\n');
      } else {
        process.stdout.write(formatLabelList(labels) + '\n');
      }
    }
    return;
  }

  if (subcommand === 'create') {
    if (positional.length === 0) throw new Error('Usage: pl label create <name>');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const data = (await ctx.client.post(
      ctx.client.workspacePath(`projects/${projectId}/labels/`),
      { name: positional[0] },
    )) as Record<string, unknown>;
    ctx.invalidateLabels(projectId);
    if (json) {
      printJson({ name: data.name, id: data.id });
    } else {
      process.stdout.write(`Created label "${data.name}"\n`);
    }
    return;
  }

  if (subcommand === 'rename') {
    if (positional.length < 2)
      throw new Error('Usage: pl label rename <old-name> <new-name>');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const label = await ctx.resolveLabel(projectId, positional[0]);
    await ctx.client.patch(
      ctx.client.workspacePath(`projects/${projectId}/labels/${label.id}/`),
      { name: positional[1] },
    );
    ctx.invalidateLabels(projectId);
    if (json) {
      printJson({ name: positional[1], renamed: true });
    } else {
      process.stdout.write(`Renamed label "${label.name}" → "${positional[1]}"\n`);
    }
    return;
  }

  if (subcommand === 'delete') {
    if (positional.length === 0)
      throw new Error('Usage: pl label delete "LabelName" --project P');
    const projectId = await resolveProjectArg(ctx, flags, defaultProject);
    const label = await ctx.resolveLabel(projectId, positional[0]);
    await ctx.client.delete(
      ctx.client.workspacePath(`projects/${projectId}/labels/${label.id}/`),
    );
    ctx.invalidateLabels(projectId);
    if (json) {
      printJson({ name: label.name, deleted: true });
    } else {
      process.stdout.write(`Deleted label "${label.name}"\n`);
    }
    return;
  }

  if (!subcommand || (subcommand !== 'add' && subcommand !== 'remove')) {
    throw new Error('Usage: pl label add|remove PROJ-42 label-name');
  }

  if (positional.length < 2) {
    throw new Error('Usage: pl label add|remove PROJ-42 label-name');
  }

  const wi = await ctx.resolveWorkItem(positional[0]);
  const label = await ctx.resolveLabel(wi.project_id, positional[1]);

  const currentLabels: string[] = [...wi.labelIds];

  if (subcommand === 'add') {
    if (!currentLabels.includes(label.id)) {
      currentLabels.push(label.id);
    }
  } else if (subcommand === 'remove') {
    const idx = currentLabels.indexOf(label.id);
    if (idx >= 0) currentLabels.splice(idx, 1);
  }

  await ctx.client.patch(
    ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/`),
    { labels: currentLabels },
  );

  const verb = subcommand === 'add' ? 'Added' : 'Removed';
  if (json) {
    printJson({ identifier: wi.identifier, labels: currentLabels });
  } else {
    process.stdout.write(`${verb} label "${label.name}" on ${wi.identifier}\n`);
  }
}
