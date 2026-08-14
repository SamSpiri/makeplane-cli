#!/usr/bin/env node
import { loadUserDotEnvPlane, loadDotEnvPlane } from '../src/cli/dotenv.js';
import { loadConfig, validateConfig } from '../src/cli/config.js';
import { run } from '../src/cli/index.js';

loadDotEnvPlane(process.cwd());
loadUserDotEnvPlane();
const config = loadConfig();
validateConfig(config);
await run(config, process.argv.slice(2));
