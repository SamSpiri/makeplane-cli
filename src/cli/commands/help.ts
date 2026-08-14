import { bold } from '../output.js';

export type HelpMode = 'short' | 'all';

export function help(mode: HelpMode = 'short'): void {
  const text = mode === 'all' ? helpAll() : helpShort();
  process.stdout.write(text.trim() + '\n');
}

function helpShort(): string {
  return `
${helpOverview()}
${helpCoreCommands()}
${helpCoreFlags()}
${helpLegend()}
${helpShortHint()}
`;
}

function helpAll(): string {
  return `
${bold('More commands')}
  pl projects                                List projects (alias: pl project list)
  pl states                                  List states
  pl status                                  Summary by state group

${bold('Assign, label, comment')}
  pl assign PROJ-42 alice@example.com        Set assignee
  pl label add PROJ-42 backend               Add a label to a work item
  pl label remove PROJ-42 backend            Remove a label from a work item
  pl label list                              List labels
  pl label create backend
  pl label rename backend platform
  pl label delete backend
  pl comment PROJ-42 -b "text"               Add a comment (use heredoc for multiline)

${bold('Delete')}
  pl delete PROJ-42                          Delete a work item permanently

${bold('Dependencies')}
  pl dep add PROJ-42 blocked_by PROJ-7       Add a relation
  pl dep remove PROJ-42 PROJ-7               Remove a relation

${bold('Cycles & modules')}
  pl cycle list                              List cycles
  pl cycle show "Sprint 25"                  Show cycle details
  pl cycle create --title "Sprint 25"
  pl cycle update "Sprint 25" [--title "New"] [--start-date 2024-01-01] [--end-date 2024-01-14]
  pl cycle delete "Sprint 25"
  pl cycle add-issue "Sprint 24" PROJ-42
  pl cycle remove-issue "Sprint 24" PROJ-42
  pl module list                             List modules
  pl module show "Auth"                      Show module details
  pl module create --title "Auth"
  pl module update "Auth" [--title "New"] [--status planned]
  pl module delete "Auth"
  pl module add-issue "Auth" PROJ-42
  pl module remove-issue "Auth" PROJ-42

${bold('Projects')}
  pl project show PROJ                            Show project details
  pl project create --name "Name" --identifier X  Create a project
  pl project update PROJ [--name N] [--body D] [--identifier X] [--lead E] [--default-assignee E] [--network public|secret]
  pl project delete PROJ                          Delete a project (irreversible)

${bold('Cache')}
  pl cache show                             Show cache contents and disk paths
  pl cache clear                            Clear all cached data
  pl cache clear --project PROJ             Clear cache for one project

${bold('More flags')}
  --assignee, -a    Email or display name
  --limit           Max items to show
  --json            Structured JSON output
  --quiet, -q       Minimal output
  --no-color        Disable ANSI colors
  --debug           Log HTTP traffic and cache hits to stderr
  --workspace       Search across all projects
  --label, -l       Label name
  --by, --group-by  Group results by cycle, module, state, or prio (applies to list, ready, blocked)
  --format          Input/output format for descriptions & comments: text, html, markdown.
                    Input format is auto-detected from --body when omitted (headings, code, links).
  --start-date      Cycle/module start date (e.g. 2024-01-01)
  --end-date        Cycle end date
  --target-date     Module target date
  --status          Module status: backlog, planned, in-progress, paused, completed, cancelled
  --identifier      Project identifier, 1-5 uppercase chars (auto-uppercased)
  --name            Project name
  --lead            Project lead (email or display name)
  --default-assignee Default assignee (email or display name)
  --network         Project visibility: public | secret

${bold('Legend addendum')}
            Same state glyphs apply to cycles and modules

${bold('Environment')}
  PLANE_BASE_URL          Plane instance URL (required)
  PLANE_API_KEY           Personal API token (required)
  DEFAULT_WORKSPACE_SLUG  Workspace slug (required)
  PLANE_DEFAULT_PROJECT   Default project identifier (optional)
  NO_COLOR                Disable colors

${bold('Project setup')}
  Config is read from three sources (highest priority first):
  1. Shell environment variables
  2. .env.plane in the current directory
  3. ~/.config/plane-cli/.env (user-level defaults)

  Files use KEY=VALUE format. Required: PLANE_BASE_URL,
  PLANE_API_KEY, DEFAULT_WORKSPACE_SLUG. Recommended:
  PLANE_DEFAULT_PROJECT. Run \`pl\` without config to see
  the example.
`;
}

function helpOverview(): string {
  return `${bold('pl')} — Plane CLI for humans

  ${bold('Core commands')}
  pl list [--label <name>] [...]             List work items; filter by state, priority, label, assignee, cycle, module
  pl ready                                   Open items without blockers
  pl blocked                                 Open items with blockers
  pl show PROJ-42 | 42                       Show work item details; bare numbers work anywhere an issue ID is accepted
  pl create -t "Title" -b "Description"      Create a work item
  pl update 42 --priority P1                 Update a work item
  pl close PROJ-42                           Close a work item
  pl reopen PROJ-42 [--state S]              Reopen a work item
  pl delete PROJ-42                          Delete a work item (admins/creator only)
  pl search "query" [--workspace]            Search work items (--workspace for all projects)
`;
}

function helpCoreCommands(): string {
  return `Body heredoc:
  pl create -t "T" -b "$(cat << 'EOF'
  ## Heading
  - item
  EOF
  )"
`;
}

function helpCoreFlags(): string {
  return `${bold('Common flags')}
  --project, -p     Project identifier for project-scoped commands
  --state, -s       State name
  --priority        urgent | high | medium | low | none
  --title, -t       Work item title
  --body, -b        Work item description or comment body (heredoc recommended)
  --help-all        Show extended help; individual commands don't have their own --help
`;
}

function helpShortHint(): string {
  return `
Hint: run \`pl help-all\` for more commands and flags.
`;
}

function helpLegend(includeExtraLine = false): string {
  return `${bold('Legend')}
  State:    ○ backlog   ◌ unstarted   ◐ started   ● completed   ✕ cancelled
${includeExtraLine ? '            (same glyphs apply to cycles and modules)\n' : ''}  Priority: P0 urgent   P1 high   P2 medium   P3 low   P4 none
`;
}
