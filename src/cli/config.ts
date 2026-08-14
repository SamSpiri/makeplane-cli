export interface CliConfig {
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  defaultProject: string | null;
}

export function loadConfig(): CliConfig {
  const baseUrl = (process.env.PLANE_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.PLANE_API_KEY || '';
  const workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG || '';
  const defaultProject = process.env.PLANE_DEFAULT_PROJECT || null;

  return { baseUrl, apiKey, workspaceSlug, defaultProject };
}

export function validateConfig(config: CliConfig): void {
  const missing: string[] = [];
  if (!config.baseUrl) missing.push('PLANE_BASE_URL');
  if (!config.apiKey) missing.push('PLANE_API_KEY');
  if (!config.workspaceSlug) missing.push('DEFAULT_WORKSPACE_SLUG');
  if (missing.length > 0) {
    process.stderr.write(
      `Error: Required config missing: ${missing.join(', ')}.\n` +
        `Provide via environment variables, a .env.plane file in the current directory, or ~/.config/plane-cli/.env (in that precedence order).\n`,
    );
    process.exit(1);
  }
}
