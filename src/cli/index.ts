import { PlaneClient } from '../plane-client.js';
import { ResolverContext, ResolveError } from './resolvers.js';
import { CacheStore, handleCache } from './cache.js';
import { parse } from './parser.js';
import { setColorEnabled, die } from './output.js';
import { help } from './commands/help.js';
import { handleRead } from './commands/read.js';
import { handleWrite } from './commands/write.js';
import { handleCycle } from './commands/cycle.js';
import { handleModule } from './commands/module.js';
import { handleProject } from './commands/project.js';
import { handleLabel } from './commands/label.js';
import type { CliConfig } from './config.js';

const READ_COMMANDS = new Set([
  'projects',
  'list',
  'show',
  'search',
  'status',
  'ready',
  'blocked',
  'states',
]);

const WRITE_COMMANDS = new Set([
  'create',
  'edit',
  'close',
  'reopen',
  'assign',
  'comment',
  'dep',
  'delete',
]);

export async function run(config: CliConfig, argv: string[]): Promise<void> {
  try {
    const args = parse(argv);

    setColorEnabled(!args.flags['no-color']);

    if (args.flags['help-all'] || args.command === 'help-all') {
      help('all');
      return;
    }

    if (args.flags.help || args.command === 'help') {
      help('short');
      return;
    }

    const client = new PlaneClient({
      baseUrl: config.baseUrl,
      workspaceSlug: config.workspaceSlug,
      apiKey: config.apiKey,
      debug: !!args.flags.debug,
    });

    const cache = new CacheStore();
    const ctx = new ResolverContext(client, cache, config.defaultProject);

    if (args.command === 'cache') {
      const resolveProjectId = async (input: string): Promise<string> => {
        const proj = await ctx.resolveProject(input);
        return proj.id;
      };
      await handleCache(args, cache, resolveProjectId);
      return;
    }

    if (args.command === 'cycle') {
       await handleCycle(ctx, args, config.defaultProject);
     } else if (args.command === 'module') {
       await handleModule(ctx, args, config.defaultProject);
     } else if (args.command === 'label') {
       await handleLabel(ctx, args, config.defaultProject);
     } else if (args.command === 'project') {
       await handleProject(ctx, args, config.defaultProject);
    } else if (READ_COMMANDS.has(args.command)) {
      await handleRead(ctx, args, config.defaultProject);
    } else if (WRITE_COMMANDS.has(args.command)) {
      await handleWrite(ctx, args, config.defaultProject);
    } else {
      die(`Unknown command: ${args.command}\nTry: pl help`);
    }
  } catch (err) {
    if (err instanceof ResolveError) {
      die(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    die(message);
  }
}
