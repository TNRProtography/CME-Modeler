export interface ApiClientOptions {
  baseUrl: string;
  retries?: number;
  cacheTtlMs?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ApiClient {
  private cache = new Map<string, CacheEntry<unknown>>();
  private baseUrl: string;
  private retries: number;
  private cacheTtlMs: number;

  constructor({ baseUrl, retries = 2, cacheTtlMs = 30_000 }: ApiClientOptions) {
    this.baseUrl = baseUrl;
    this.retries = retries;
    this.cacheTtlMs = cacheTtlMs;
  }

  private async request<T>(path: string): Promise<T> {
    const now = Date.now();
    const cacheKey = `${path}`;
    const cached = this.cache.get(cacheKey) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const json = (await res.json()) as T;
        this.cache.set(cacheKey, { value: json, expiresAt: now + this.cacheTtlMs });
        return json;
      } catch (err) {
        lastError = err;
        if (attempt === this.retries) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  getRuns() {
    return this.request<RunSummary[]>('/runs');
  }

  getRunDetail(id: string) {
    return this.request<RunDetailResponse>(`/runs/${id}`);
  }

  getCatalog() {
    return this.request<CatalogEntry[]>('/catalog');
  }

  getAlerts() {
    return this.request<AlertPreference[]>('/alerts');
  }
}

export interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
}

export interface RunDetailResponse extends RunSummary {
  parameters: Record<string, number>;
  models: string[];
  outputs: string[];
}

export interface CatalogEntry {
  id: string;
  date: string;
  speed: number;
}

export interface AlertPreference {
  userId: string;
  arrivalWindow: number;
  speedThreshold: number;
  kpThreshold: number;
}
