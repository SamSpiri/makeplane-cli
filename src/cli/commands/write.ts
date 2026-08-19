import { ResolverContext } from '../resolvers.js';
import { ParsedArgs } from '../parser.js';
import { printJson } from '../output.js';
import { bodyToHtml } from '../html.js';
import { resolveProjectArg } from './_helpers.js';

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

interface EditBody {
  name?: string;
  description_html?: string;
  priority?: string;
  state?: string;
  assignees?: string[];
  labels?: string[];
}

async function buildEditBody(
  ctx: ResolverContext,
  flags: Record<string, string | boolean>,
  projectId: string,
): Promise<EditBody> {
  const body: EditBody = {};

  if (flags.title) body.name = flags.title as string;
  if (flags.body)
    body.description_html = bodyToHtml(flags.body as string, flags.format as string | undefined);
  if (flags.priority) body.priority = priorityValue(flags.priority as string);
  if (flags.state) {
    const st = await ctx.resolveState(projectId, flags.state as string);
    body.state = st.id;
  }
  if (flags.assignee) {
    const mb = await ctx.resolveMember(flags.assignee as string);
    body.assignees = [mb.id];
  }

  return body;
}

export async function handleWrite(
  ctx: ResolverContext,
  args: ParsedArgs,
  defaultProject: string | null,
): Promise<void> {
  const { command, subcommand, flags, positional } = args;
  const json = !!flags.json;

  switch (command) {
    // ── create ──
    case 'create': {
      const projectId = await resolveProjectArg(ctx, flags, defaultProject);
      const project = await ctx.resolveProjectById(projectId);
      const body = await buildEditBody(ctx, flags, projectId);

      if (!flags.title) throw new Error('--title is required for create');

      const data = (await ctx.client.post(
        ctx.client.workspacePath(`projects/${projectId}/issues/`),
        body as Record<string, unknown>,
      )) as Record<string, unknown>;

      const seq = data.sequence_id as number;
      const identifier = `${project.identifier}-${seq}`;

      if (json) {
        printJson({
          identifier,
          id: data.id,
          project: project.identifier,
        });
      } else if (flags.quiet) {
        process.stdout.write(identifier + '\n');
      } else {
        process.stdout.write(identifier + '\n');
      }
      return;
    }

    // ── edit ──
    case 'edit': {
      if (positional.length === 0) {
        throw new Error('Usage: pl edit PROJ-42 [flags]');
      }
      const wi = await ctx.resolveWorkItem(positional[0]);
      const body = await buildEditBody(ctx, flags, wi.project_id);

      if (Object.keys(body).length === 0) {
        throw new Error('No changes specified. Use flags like --priority, --state, --title, etc.');
      }

      await ctx.client.patch(
        ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/`),
        body as Record<string, unknown>,
      );

      if (json) {
        printJson({ identifier: wi.identifier, edited: true });
      } else {
        process.stdout.write(`Edited ${wi.identifier}\n`);
      }
      return;
    }

    // ── close ──
    case 'close': {
      if (positional.length === 0) {
        throw new Error('Usage: pl close PROJ-42');
      }
      const wi = await ctx.resolveWorkItem(positional[0]);
      const completed = await ctx.resolveCompletedState(wi.project_id);

      await ctx.client.patch(
        ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/`),
        { state: completed.id },
      );

      if (json) {
        printJson({ identifier: wi.identifier, state: completed.name });
      } else {
        process.stdout.write(`Closed ${wi.identifier} → ${completed.name}\n`);
      }
      return;
    }

    // ── reopen ──
    case 'reopen': {
      if (positional.length === 0) {
        throw new Error('Usage: pl reopen PROJ-42 [--state S]');
      }
      const wi = await ctx.resolveWorkItem(positional[0]);

      let targetState;
      if (flags.state) {
        targetState = await ctx.resolveState(wi.project_id, flags.state as string);
      } else {
        targetState = await ctx.resolveUnstartedState(wi.project_id);
      }

      await ctx.client.patch(
        ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/`),
        { state: targetState.id },
      );

      if (json) {
        printJson({ identifier: wi.identifier, state: targetState.name });
      } else {
        process.stdout.write(`Reopened ${wi.identifier} → ${targetState.name}\n`);
      }
      return;
    }

    // ── assign ──
    case 'assign': {
      if (positional.length < 2) {
        throw new Error('Usage: pl assign PROJ-42 email-or-name');
      }
      const wi = await ctx.resolveWorkItem(positional[0]);
      const member = await ctx.resolveMember(positional[1]);

      await ctx.client.patch(
        ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/`),
        { assignees: [member.id] },
      );

      if (json) {
        printJson({
          identifier: wi.identifier,
          assignee: member.display_name || member.email,
        });
      } else {
        process.stdout.write(`${wi.identifier} → ${member.display_name || member.email}\n`);
      }
      return;
    }

    // ── comment ──
    case 'comment': {
      if (positional.length < 1 || !flags.message || typeof flags.message !== 'string') {
        throw new Error(
          'Usage: pl comment PROJ-42 -m "text" [--format html|markdown] (use heredoc for multiline)',
        );
      }
      const wi = await ctx.resolveWorkItem(positional[0]);
      const text = flags.message as string;
      const html = bodyToHtml(text, flags.format as string | undefined);

      await ctx.client.post(
        ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/comments/`),
        { comment_html: html },
      );

      if (json) {
        printJson({ identifier: wi.identifier, commented: true });
      } else {
        process.stdout.write(`Commented on ${wi.identifier}\n`);
      }
      return;
    }

    // ── delete ──
    case 'delete': {
      if (positional.length === 0) {
        throw new Error('Usage: pl delete PROJ-42');
      }
      const wi = await ctx.resolveWorkItem(positional[0]);

      await ctx.client.delete(
        ctx.client.workspacePath(`projects/${wi.project_id}/work-items/${wi.id}/`),
      );

      if (json) {
        printJson({ identifier: wi.identifier, deleted: true });
      } else {
        process.stdout.write(`Deleted ${wi.identifier}\n`);
      }
      return;
    }

    // ── dep ──
    case 'dep': {
      if (subcommand === 'add') {
        if (positional.length < 3) {
          throw new Error('Usage: pl dep add PROJ-42 blocked_by PROJ-7');
        }
        const wi = await ctx.resolveWorkItem(positional[0]);
        const relType = positional[1];
        const target = await ctx.resolveWorkItem(positional[2]);

        await ctx.client.post(
          ctx.client.workspacePath(`projects/${wi.project_id}/issues/${wi.id}/relations/`),
          {
            relation_type: relType,
            issues: [target.id],
          },
        );

        if (json) {
          printJson({
            identifier: wi.identifier,
            relation: relType,
            target: target.identifier,
          });
        } else {
          process.stdout.write(`${wi.identifier} ${relType} ${target.identifier}\n`);
        }
      } else if (subcommand === 'remove') {
        if (positional.length < 2) {
          throw new Error('Usage: pl dep remove PROJ-42 PROJ-7');
        }
        const wi = await ctx.resolveWorkItem(positional[0]);
        const target = await ctx.resolveWorkItem(positional[1]);

        const relations = await ctx.listRelations(wi.project_id, wi.id);
        const rel = relations.find((r) => {
          return r.related_issue_id === target.id;
        });

        if (!rel) {
          throw new Error(`No relation found between ${wi.identifier} and ${target.identifier}`);
        }

        await ctx.client.post(
          ctx.client.workspacePath(
            `projects/${wi.project_id}/work-items/${wi.id}/relations/remove/`,
          ),
          { related_issue: target.id },
        );

        if (json) {
          printJson({ identifier: wi.identifier, removed: target.identifier });
        } else {
          process.stdout.write(`Removed relation: ${wi.identifier} ↛ ${target.identifier}\n`);
        }
      } else {
        throw new Error('Usage: pl dep add|remove ...');
      }
      return;
    }

    default:
      throw new Error(`Unknown write command: ${command}`);
  }
}
