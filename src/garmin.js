const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class GarminError extends Error {
  constructor(status, source) {
    super(`Garmin ${source}: HTTP ${status}. ${status === 401 ? 'Sprawdź ważność klucza.' : status === 403 ? 'Brak uprawnień do danych.' : status === 429 ? 'Limit zapytań; spróbuj później.' : 'Dane chwilowo niedostępne.'}`);
    this.status = status;
  }
}

export class GarminClient {
  constructor({ apiKey, baseUrl, fetchImpl = fetch, wait = sleep, now = () => Date.now() }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.wait = wait;
    this.now = now;
    this.token = null;
    this.pendingToken = null;
    this.cache = new Map();
  }

  async request(path, options, source) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await this.fetch(new URL(path, this.baseUrl), {
          ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
        });
      } catch {
        if (attempt === 2) throw new Error(`Brak połączenia z Garmin (${source}); sprawdź sieć.`);
        await this.wait(250 * 2 ** attempt);
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retryAfter = response.headers.get('retry-after');
        const requestedWait = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 250 * 2 ** attempt;
        // Do not hold an MCP call open or retry earlier than a long Retry-After.
        if (requestedWait > 2000) { await response.body?.cancel(); throw new GarminError(response.status, source); }
        await response.body?.cancel();
        await this.wait(requestedWait);
        continue;
      }
      return response;
    }
  }

  async bodyText(response, source) {
    const maxBytes = 8 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel(); throw new Error(`Odpowiedź Garmin (${source}) przekracza limit danych.`);
    }
    const reader = response.body?.getReader();
    if (!reader) return '';
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error(`Odpowiedź Garmin (${source}) przekracza limit danych.`); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async json(response, source) {
    if (response.status === 204 || response.status === 404) return null;
    if (!response.ok) { await response.body?.cancel(); throw new GarminError(response.status, source); }
    const body = await this.bodyText(response, source);
    if (!body) return null;
    try { return JSON.parse(body); }
    catch { throw new Error(`Nieprawidłowa odpowiedź JSON Garmin (${source}).`); }
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60000) return this.token.value;
    if (!this.pendingToken) {
      this.pendingToken = (async () => {
        const response = await this.request('/personalapitoken-service/personal-api/personal-api-key/token', {
          // Garmin's token endpoint returns text/plain. Requesting only JSON
          // causes HTTP 406 (verified against the live Personal API).
          method: 'POST', headers: { Authorization: `ApiKey ${this.apiKey}` },
        }, 'token');
        if (!response.ok) { await response.body?.cancel(); throw new GarminError(response.status, 'token'); }
        const body = (await this.bodyText(response, 'token')).trim();
        let data = {};
        let value;
        if (response.headers.get('content-type')?.includes('json')) {
          try { data = JSON.parse(body); value = data?.access_token ?? data?.accessToken; }
          catch { throw new Error('Nieprawidłowy format tokena Garmin.'); }
        } else value = body;
        if (typeof value !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(value)) throw new Error('Garmin nie zwrócił tokena dostępu.');
        const seconds = Number(data.expires_in ?? data.expiresIn ?? 86400);
        this.token = { value, expiresAt: this.now() + Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 86400, 86400) * 1000 };
        return value;
      })().finally(() => { this.pendingToken = null; });
    }
    return this.pendingToken;
  }

  async get(path, query = {}) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Nieprawidłowa ścieżka API.');
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    const key = url.pathname + url.search;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return { ...cached.result, cached: true };
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      response = await this.request(key, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, path);
      if (response.status !== 401 || attempt === 1) break;
      await response.body?.cancel();
      if (this.token?.value === token) this.token = null;
    }
    const data = await this.json(response, path);
    const result = { data, fetchedAt: new Date(this.now()).toISOString(), cached: false };
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { result, expiresAt: this.now() + 300000 });
    return result;
  }

  async activities(startDate, endDate, maxItems = 2000, search) {
    const items = [];
    const sources = [];
    let truncated = false;
    for (let start = 0; start < maxItems; start += 99) {
      const limit = Math.min(99, maxItems - start);
      const result = await this.get('/activitylist-service/activities/search/activities', {
        start, limit, startDate, endDate, search, sortBy: 'startLocal', sortOrder: 'desc', excludeChildren: false,
      });
      sources.push({ endpoint: 'activities', fetchedAt: result.fetchedAt, cached: result.cached });
      if (result.data !== null && !Array.isArray(result.data)) throw new Error('Nieznany format listy aktywności Garmin.');
      const page = result.data || [];
      items.push(...page);
      if (page.length < limit) break;
      if (items.length >= maxItems) truncated = true;
    }
    return { items, sources, truncated };
  }
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await fn(items[index], index); }
  }));
  return results;
}
