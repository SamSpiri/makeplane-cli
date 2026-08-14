# Contributing

Thanks for your interest in contributing to the Plane CLI!

## Prerequisites

- Node.js >= 20
- npm

## Setup

```bash
git clone https://github.com/SamSpiri/makeplane-cli.git
cd makeplane-cli
npm install
```

## Development

```bash
# Run in dev mode (set env vars, create ~/.config/plane-cli/.env, or create .env.plane first)
npm run dev

# Type-check
npm run typecheck

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format:fix
```

## Adding a Command

1. Create a command file under `src/cli/commands/` (e.g. `mycmd.ts`).
2. Export an `async` handler that takes `ResolverContext` and `ParsedArgs`.
3. Register the command in `src/cli/index.ts` by adding it to `READ_COMMANDS` or `WRITE_COMMANDS` and wiring the handler.
4. Add help text in `src/cli/commands/help.ts`.
5. Add tests in the relevant `src/**/__tests__/` directory.
6. Run `npm run lint && npm test` to verify.

If the command requires resolving new entity types (e.g. a new Plane resource), add a resolver method in `src/cli/resolvers.ts`.

## Code Style

- ESLint + Prettier enforce style automatically
- A pre-commit hook runs `lint-staged` (ESLint + Prettier) on staged files — if it fails, fix the issues before committing
- Run `npm run format:fix` to auto-fix formatting
- TypeScript strict mode is enabled

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes
3. Ensure `npm run lint && npm run typecheck && npm test` all pass
4. Open a PR against `main`
