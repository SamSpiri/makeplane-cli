const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_RETRIES = 4;
const PROACTIVE_THROTTLE_THRESHOLD = 2;
const RATE_LIMIT_MAX_WAIT_SEC = 60;

const JITTER_MS = 2000;

function hintFor(status: number, method: string, path: string): string {
  switch (status) {
    case 401:
      return `Plane API 401 on ${method} ${path}: authentication failed — check PLANE_API_KEY`;
    case 403:
      return `Plane API 403 on ${method} ${path}: the resource may not exist, or your API key lacks permission to access it`;
    case 404:
      return `Plane API 404 on ${method} ${path}: not found — check the identifier and that the project is correct`;
    default:
      return `Plane API ${status} on ${method} ${path}`;
  }
}

export interface PlaneClientConfig {
  baseUrl: string;
  workspaceSlug: string;
  apiKey: string;
  debug?: boolean;
}

export class PlaneClient {
  private baseUrl: string;
  private workspaceSlug: string;
  private apiKey: string;
  private _debug: boolean;
  private _nextAllowedAt = 0;
  private _lastResetEpoch = 0;

  constructor(config: PlaneClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.workspaceSlug = config.workspaceSlug;
    this.apiKey = config.apiKey;
    this._debug = config.debug ?? false;
  }

  get debug(): boolean {
    return this._debug;
  }

  private _maskKey(key: string): string {
    if (key.length <= 8) return '***';
    return `${key.slice(0, 4)}…${key.slice(-2)}`;
  }

  private _dbg(line: string): void {
    if (this._debug) process.stderr.write(`[debug] ${line}\n`);
  }

  workspacePath(subpath: string): string {
    return `/api/v1/workspaces/${this.workspaceSlug}/${subpath.replace(/^\//, '')}`;
  }

  private stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private async _waitIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now < this._nextAllowedAt) {
      await new Promise((resolve) => setTimeout(resolve, this._nextAllowedAt - now));
    }
  }

  private _readResetEpoch(headers: Headers): number | null {
    const v = headers.get('X-RateLimit-Reset');
    if (!v) return null;
    const n = parseInt(v);
    return isNaN(n) ? null : n;
  }

  private _updateRateLimit(headers: Headers): void {
    const remaining = headers.get('X-RateLimit-Remaining');
    const resetEpoch = this._readResetEpoch(headers);
    if (resetEpoch !== null) {
      this._lastResetEpoch = resetEpoch;
    }

    if (!remaining) return;
    const rem = parseInt(remaining);
    if (isNaN(rem) || rem > PROACTIVE_THROTTLE_THRESHOLD) return;

    if (resetEpoch === null) return;

    this._nextAllowedAt = Math.max(this._nextAllowedAt, resetEpoch * 1000 + JITTER_MS);
  }

  async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>,
  ): Promise<unknown> {
    let url = `${this.baseUrl}${path}`;
    if (queryParams) {
      const filtered = Object.entries(queryParams).filter(
        ([, v]) => v !== undefined && v !== null && v !== '',
      );
      if (filtered.length > 0) {
        url += '?' + new URLSearchParams(filtered).toString();
      }
    }

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      Accept: 'application/json',
    };

    const options: RequestInit = { method, headers };

    if (
      body &&
      (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
    ) {
      const cleaned = this.stripNulls(body);
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(cleaned);
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await this._waitIfNeeded();

      const reqStarted = Date.now();
      this._dbg(`→ ${method} ${url}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
      this._dbg(`  headers: x-api-key=${this._maskKey(this.apiKey)}, accept=${headers.Accept ?? ''}${headers['Content-Type'] ? `, content-type=${headers['Content-Type']}` : ''}`);
      if (options.body) this._dbg(`  body: ${options.body}`);

      const response = await fetch(url, options);

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
        throw new Error(`Response too large (${contentLength} bytes)`);
      }

      const text = await response.text();

      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error(`Response too large (${text.length} bytes)`);
      }

      const respHeaders: string[] = [];
      for (const h of ['content-type', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
        const v = response.headers.get(h);
        if (v) respHeaders.push(`${h}=${v}`);
      }
      this._dbg(`← ${response.status} (${Date.now() - reqStarted}ms) ${respHeaders.join(' ')}`);

      // 429 — retry with rate-limit-aware backoff
      if (response.status === 429 && attempt < MAX_RETRIES) {
        this._dbg(`  body: ${text}`);
        const resetEpoch = this._readResetEpoch(response.headers) || this._lastResetEpoch;
        if (resetEpoch > 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const waitSec = resetEpoch - nowSec + 2;
          if (waitSec > 0 && waitSec <= RATE_LIMIT_MAX_WAIT_SEC) {
            this._nextAllowedAt = Math.max(this._nextAllowedAt, resetEpoch * 1000 + JITTER_MS);
            process.stderr.write(`Rate limited. Waiting ${waitSec}s for window reset.\n`);
            continue;
          }
        }

        // Cold start: no reset info — use conservative Plane window estimate
        const baseSec = attempt >= 2 ? 90 : 60;
        const delayMs = baseSec * 1000 + Math.floor(Math.random() * 2000);
        this._nextAllowedAt = Math.max(this._nextAllowedAt, Date.now() + delayMs);
        process.stderr.write(
          `Rate limited. Waiting ${Math.round(delayMs / 1000)}s for window reset.\n`,
        );
        continue;
      }

      // Proactive throttle on successful responses
      if (response.ok) {
        this._updateRateLimit(response.headers);
      }

      if (!response.ok) {
        this._dbg(`  body: ${text}`);
        process.stderr.write(`Plane API error ${response.status}: ${text.slice(0, 500)}\n`);
        throw new Error(hintFor(response.status, method, path));
      }

      if (!text || text.trim() === '') {
        return { success: true };
      }

      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }

    throw new Error(`Plane API error 429 after ${MAX_RETRIES + 1} attempts`);
  }

  async get(path: string, queryParams?: Record<string, string>): Promise<unknown> {
    return this.request('GET', path, undefined, queryParams);
  }

  async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', path, body);
  }

  async patch(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request('PATCH', path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }

}
