import { parseArgs } from 'node:util';

export interface ParsedArgs {
  command: string;
  subcommand: string | undefined;
  flags: Record<string, string | boolean>;
  positional: string[];
}

const OPTIONS = {
  project: { type: 'string', short: 'p' },
  state: { type: 'string', short: 's' },
  label: { type: 'string', short: 'l' },
  priority: { type: 'string' },
  assignee: { type: 'string', short: 'a' },
  cycle: { type: 'string' },
  module: { type: 'string' },
  title: { type: 'string', short: 't' },
  body: { type: 'string', short: 'b' },
  message: { type: 'string', short: 'm' },
  limit: { type: 'string' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  'help-all': { type: 'boolean' },
  debug: { type: 'boolean' },
  by: { type: 'string' },
  'group-by': { type: 'string' },
  format: { type: 'string' },
  workspace: { type: 'boolean' },
  'start-date': { type: 'string' },
  'end-date': { type: 'string' },
  'target-date': { type: 'string' },
  status: { type: 'string' },
  identifier: { type: 'string' },
      name: { type: 'string' },
      lead: { type: 'string' },
      'default-assignee': { type: 'string' },
  network: { type: 'string' },
} as const;

export function parse(argv: string[]): ParsedArgs {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const result = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    values = result.values;
    positionals = result.positionals;
  } catch (err) {
    if (err instanceof TypeError && (err as { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      const m = err.message.match(/^Unknown option '(.+?)'/);
      const name = m ? m[1] : '?';
      throw new Error(`Unknown flag: ${name}\nRun "pl help" to see available flags.`, { cause: err });
    }
    throw err;
  }

  const cmd = positionals[0] || 'help';
  const rest = positionals.slice(1);

  const subcommands: Record<string, string[]> = {
    label: ['add', 'remove', 'list', 'create', 'rename', 'delete'],
    dep: ['add', 'remove'],
    cycle: ['add-issue', 'remove-issue', 'list', 'create', 'edit', 'delete', 'show'],
    module: ['add-issue', 'remove-issue', 'list', 'create', 'edit', 'delete', 'show'],
    project: ['list', 'show', 'create', 'edit', 'delete'],
    cache: ['clear', 'show'],
  };

  let subcommand: string | undefined;
  let positional: string[];

  const candidates = subcommands[cmd];
  if (candidates && rest.length > 0 && candidates.includes(rest[0])) {
    subcommand = rest[0];
    positional = rest.slice(1);
  } else {
    positional = rest;
  }

  const flags: Record<string, string | boolean> = {};
  for (const [key, val] of Object.entries(values)) {
    if (val !== undefined) {
      flags[key] = val;
    }
  }

  if (!flags.by && flags['group-by']) {
    flags.by = flags['group-by'];
  }

  return { command: cmd, subcommand, flags, positional };
}
