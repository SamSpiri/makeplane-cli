import { ResolverContext } from '../resolvers.js';
import type { OutputFormat } from '../formatters.js';

export async function resolveProjectArg(
  ctx: ResolverContext,
  flags: Record<string, string | boolean>,
  defaultProject: string | null,
): Promise<string> {
  if (flags.project) return (await ctx.resolveProject(flags.project as string)).id;

  if (defaultProject) return (await ctx.resolveProject(defaultProject)).id;

  throw new Error('No project specified. Use --project or set PLANE_DEFAULT_PROJECT.');
}

const SHOW_FORMATS = new Set(['text', 'markdown', 'html']);

export function resolveShowFormat(raw: string | undefined, noColor = false): OutputFormat {
  if (raw === undefined) return noColor ? 'markdown' : 'text';
  if (!SHOW_FORMATS.has(raw)) {
    throw new Error(`Invalid --format "${raw}". Must be one of: text, markdown, html.`);
  }
  return raw as OutputFormat;
}
