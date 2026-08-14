import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson, dim, bold, cyan, red } from '../output.js';
import { formatProjects, formatProjectShow } from '../formatters.js';
import { bodyToHtml } from '../html.js';
import { resolveShowFormat } from './_helpers.js';

const IDENTIFIER_RE = /^[A-Z0-9]{1,5}$/;

function normalizeIdentifier(input: string): string {
  const upper = input.toUpperCase();
  if (!IDENTIFIER_RE.test(upper)) {
    throw new Error(
      `Invalid project identifier "${input}". Must be 1-5 uppercase letters or digits.`,
    );
  }
  return upper;
}

function networkValue(input: string): number {
  const lc = input.toLowerCase();
  if (lc === 'public') return 2;
  if (lc === 'secret') return 0;
  throw new Error(`Invalid --network "${input}". Must be "public" or "secret".`);
}

function networkLabel(value: unknown): string {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''));
  if (n === 0) return 'secret';
  if (n === 2) return 'public';
  return String(value ?? '?');
}

async function resolveOptionalMember(
  ctx: ResolverContext,
  input: string,
  flag: string,
): Promise<string | undefined> {
  try {
    const member = await ctx.resolveMember(input);
    return member.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`--${flag} resolution failed: ${msg}`, { cause: err });
  }
}

export async function handleProject(
  ctx: ResolverContext,
  args: ParsedArgs,
  _defaultProject: string | null,
): Promise<void> {
  const { subcommand, flags, positional } = args;
  const json = !!flags.json;

  if (subcommand === 'list') {
    const projects = await ctx.loadProjects();
    if (json) {
      printJson(projects);
    } else if (projects.length === 0) {
      process.stdout.write(dim('(no projects)') + '\n');
    } else {
      process.stdout.write(formatProjects(projects) + '\n');
    }
    return;
  }

  if (subcommand === 'show') {
    if (positional.length === 0) {
      throw new Error('Usage: pl project show PROJ');
    }
    const format = resolveShowFormat(flags.format as string | undefined, !!flags['no-color']);
    const project = await ctx.resolveProject(positional[0]);
    const data = await ctx.fetchRaw(`projects/${project.id}/`);
    const detail = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

    if (json) {
      printJson({ project: { ...project, ...detail } });
    } else {
      process.stdout.write(formatProjectShow(project, detail, format) + '\n');
    }
    return;
  }

  if (subcommand === 'create') {
    if (!flags.name) throw new Error('--name is required for project create');
    if (!flags.identifier) throw new Error('--identifier is required for project create');
    const identifier = normalizeIdentifier(flags.identifier as string);
    const body: Record<string, unknown> = {
      name: flags.name as string,
      identifier,
    };
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags.lead) {
      body.project_lead = await resolveOptionalMember(ctx, flags.lead as string, 'lead');
    }
    if (flags['default-assignee']) {
      body.default_assignee = await resolveOptionalMember(
        ctx,
        flags['default-assignee'] as string,
        'default-assignee',
      );
    }
    if (flags.network) body.network = networkValue(flags.network as string);

    const data = (await ctx.client.post(ctx.client.workspacePath('projects/'), body)) as Record<
      string,
      unknown
    >;

    await ctx.invalidateProjects();

    if (json) {
      printJson({ id: data.id, name: data.name, identifier: data.identifier });
    } else {
      const net = data.network !== undefined ? ` [${networkLabel(data.network)}]` : '';
      process.stdout.write(
        `Created project ${bold(String(data.identifier))} ${cyan(`"${data.name}"`)}${net}\n`,
      );
    }
    return;
  }

  if (subcommand === 'update') {
    if (positional.length === 0) {
      throw new Error(
        'Usage: pl project update PROJ [--name N] [--identifier X] [--body D] [--lead E] [--default-assignee E] [--network public|secret]',
      );
    }
    const project = await ctx.resolveProject(positional[0]);
    const body: Record<string, unknown> = {};
    if (flags.name) body.name = flags.name as string;
    if (flags.identifier) body.identifier = normalizeIdentifier(flags.identifier as string);
    if (flags.body)
      body.description = bodyToHtml(flags.body as string, flags.format as string | undefined);
    if (flags.lead) {
      body.project_lead = await resolveOptionalMember(ctx, flags.lead as string, 'lead');
    }
    if (flags['default-assignee']) {
      body.default_assignee = await resolveOptionalMember(
        ctx,
        flags['default-assignee'] as string,
        'default-assignee',
      );
    }
    if (flags.network) body.network = networkValue(flags.network as string);

    if (Object.keys(body).length === 0) {
      throw new Error(
        'No changes specified. Use --name, --identifier, --body, --lead, --default-assignee, or --network.',
      );
    }

    await ctx.client.patch(ctx.client.workspacePath(`projects/${project.id}/`), body);
    await ctx.invalidateProjects();

    if (json) {
      printJson({ identifier: project.identifier, updated: true, ...body });
    } else {
      process.stdout.write(
        `Updated project ${bold(project.identifier)} ${cyan(`"${(body.name as string) || project.name}"`)}\n`,
      );
    }
    return;
  }

  if (subcommand === 'delete') {
    if (positional.length === 0) {
      throw new Error('Usage: pl project delete PROJ');
    }
    const project = await ctx.resolveProject(positional[0]);

    const identifier = project.identifier;
    process.stderr.write(
      `Deleting project ${bold(identifier)} (${cyan(`"${project.name}"`)}).\n` +
        red('This permanently removes the project and all its data.\n'),
    );

    await ctx.client.delete(ctx.client.workspacePath(`projects/${project.id}/`));
    await ctx.invalidateProjects();

    if (json) {
      printJson({ identifier: project.identifier, deleted: true });
    } else {
      process.stdout.write(`Deleted project ${bold(identifier)}\n`);
    }
    return;
  }

  throw new Error('Usage: pl project list|show|create|update|delete ...');
}
