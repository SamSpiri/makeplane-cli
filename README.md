# `pl` — Plane from your terminal

[![npm version](https://img.shields.io/npm/v/%40samspiri%2Fmakeplane-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@samspiri/makeplane-cli)
[![CI](https://github.com/SamSpiri/makeplane-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/SamSpiri/makeplane-cli/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

AI-first CLI for [Plane](https://plane.so). Give agents a compact, predictable interface for finding, creating, updating, and organizing work items without exposing UUID plumbing.

Built for agent workflows: commands are composable, `--json` avoids screen-scraping, and names such as `DEV-42`, `backend`, or `Sprint 24` are resolved against Plane at request time.

```text
○ DEV-42  P1  Fix OAuth callback parsing
◐ DEV-43  P2  Add parser regression tests
```

## Install

Requires **Node.js 20 or newer**.

```bash
npm install --global @samspiri/makeplane-cli
pl --help
```

Try it without a global install:

```bash
npx --yes --package @samspiri/makeplane-cli pl --help
```

### Install from source

Use this if you want the latest development version or plan to contribute:

```bash
git clone https://github.com/SamSpiri/makeplane-cli.git
cd makeplane-cli
npm install
npm run build
npm test
npm link
pl --help
```

`npm link` makes the locally built `pl` command available globally. To remove the link later, run `npm unlink --global @samspiri/makeplane-cli`.

## Connect to Plane

Create a personal API token in Plane under **Settings → Account → API tokens**. You also need the workspace slug from your workspace URL.

Set these variables in your shell, or put them in the global config file `~/.config/plane-cli/.env`:

```dotenv
PLANE_BASE_URL=https://plane.example.com
PLANE_API_KEY=your-personal-api-token
DEFAULT_WORKSPACE_SLUG=my-workspace
PLANE_DEFAULT_PROJECT=DEV
```

Keep this file private and set its permissions to `600`:

```bash
mkdir -p ~/.config/plane-cli
chmod 700 ~/.config/plane-cli
chmod 600 ~/.config/plane-cli/.env
```

For project-specific defaults, create `.env.plane` in the project directory. It can set `PLANE_DEFAULT_PROJECT` or override any global value. Shell environment variables always take precedence.

Configuration precedence, highest first, is:

1. shell environment variables
2. `.env.plane` in the current directory
3. `~/.config/plane-cli/.env`

Keep API tokens out of git. The repository ignores `.env*` files by default.

## Quick start

```bash
pl projects                              # List projects
pl list --project DEV                    # List work items
pl show DEV-42                           # Inspect an item
pl create --project DEV --title "Fix bug"
pl edit DEV-42 --priority high
pl close DEV-42
pl comment DEV-42 -m "Verified in staging"
pl label add DEV-42 backend
pl cycle list --project DEV
pl module list --project DEV
pl search "oauth bug"
```

Useful filters include `--state`, `--priority`, `--label`, `--assignee`, `--cycle`, and `--module`. Use `--json` for scripts and `--no-color` for plain output.

Run `pl help-all` for the complete command and flag reference.

### Agent-friendly by design

- Plane's native work-item IDs (`DEV-42`) are the public interface; UUIDs stay internal.
- Projects, states, labels, cycles, modules, and assignees can be addressed by names.
- Resolution is live by default, so renamed Plane resources do not leave a stale local ID database behind.
- Use `--quiet` when a command should return only its primary result, and `--debug` to send HTTP/cache diagnostics to stderr.

### Descriptions and comments

Use `--format text`, `--format html`, or `--format markdown` with `show`, `create`, `edit`, and `comment`:

```bash
pl create --project DEV --title "Release checklist" \
  --body $'## Checklist\n- Run tests\n- Deploy staging' \
  --format markdown
```

Plain text is the default. Markdown is converted to HTML for Plane writes; raw HTML is passed through with `--format html`.

## What it supports

- Agent-friendly work-item IDs such as `DEV-42`; UUIDs are handled internally.
- Work-item search, listing, creation, editing, assignment, comments, labels, dependencies, and status changes.
- Cycles, modules, projects, and cache management.
- Readable terminal output plus structured `--json` output for agents and scripts.
- A small TypeScript client that can also be imported by Node.js applications.

This is a focused CLI, not a wrapper for every Plane API endpoint.

## Library usage

```ts
import { PlaneClient } from '@samspiri/makeplane-cli';

const client = new PlaneClient({
  baseUrl: 'https://plane.example.com',
  workspaceSlug: 'my-workspace',
  apiKey: process.env.PLANE_API_KEY!,
});

const projects = await client.get(client.workspacePath('projects/'));
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and pull requests. Security reports belong in [SECURITY.md](SECURITY.md).

## License

MIT
