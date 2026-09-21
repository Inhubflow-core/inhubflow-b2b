export interface WebSearchResult {
  title: string;
  link: string;
  snippet: string | null;
  date: string | null;
  source: string | null;
  position: number | null;
  imageUrl?: string | null;
}

export interface WebSearchResponse {
  items: WebSearchResult[];
  searchParameters?: Record<string, unknown>;
  creditsUsed?: number | null;
}

export interface WebSearchInput {
  query: string;
  country?: string;
  language?: string;
  limit?: number;
  page?: number;
  timeRange?: "day" | "week" | "month" | "year";
}

export class WebSearchProviderError extends Error {
  constructor(
    message: string,
    readonly code: "missing_credentials" | "invalid_credentials" | "rate_limited" | "unavailable" | "invalid_response",
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WebSearchProviderError";
  }
}

type FetchLike = typeof fetch;

function timeRangeCode(range?: WebSearchInput["timeRange"]): string | undefined {
  if (range === "day") return "qdr:d";
  if (range === "week") return "qdr:w";
  if (range === "month") return "qdr:m";
  if (range === "year") return "qdr:y";
  return undefined;
}

function classify(status: number, body: string): WebSearchProviderError {
  const normalized = body.toLowerCase();
  if (status === 401 || status === 403) return new WebSearchProviderError("La fuente web no está autorizada", "invalid_credentials", false, status);
  if (status === 429 || normalized.includes("credit") || normalized.includes("rate")) {
    return new WebSearchProviderError("La fuente web alcanzó temporalmente su límite", "rate_limited", true, status);
  }
  if (status >= 500) return new WebSearchProviderError("La fuente web no está disponible temporalmente", "unavailable", true, status);
  return new WebSearchProviderError(`La fuente web rechazó la búsqueda (HTTP ${status})`, "invalid_response", false, status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WebSearchClient {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;
  private readonly endpoint: string;

  constructor(options: { apiKey?: string; fetcher?: FetchLike; endpoint?: string } = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.SERPER_API_KEY?.trim() || "";
    this.fetcher = options.fetcher || fetch;
    this.endpoint = options.endpoint || "https://google.serper.dev/search";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(input: WebSearchInput): Promise<WebSearchResponse> {
    if (!this.apiKey) throw new WebSearchProviderError("La fuente web no está configurada", "missing_credentials", false);
    const limit = Math.max(1, Math.min(input.limit || 10, 50));
    const payload: Record<string, unknown> = {
      q: input.query,
      gl: input.country || "us",
      hl: input.language || "es",
      num: limit,
      page: Math.max(1, input.page || 1),
    };
    const tbs = timeRangeCode(input.timeRange);
    if (tbs) payload.tbs = tbs;

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: { "X-API-KEY": this.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000),
        });
        const text = await response.text();
        if (!response.ok) throw classify(response.status, text);
        let data: Record<string, unknown>;
        try { data = JSON.parse(text) as Record<string, unknown>; }
        catch { throw new WebSearchProviderError("La fuente web devolvió una respuesta inválida", "invalid_response", true, response.status); }
        const organic = Array.isArray(data.organic) ? data.organic : [];
        const items = organic.map((raw): WebSearchResult | null => {
          if (!raw || typeof raw !== "object") return null;
          const row = raw as Record<string, unknown>;
          if (typeof row.title !== "string" || typeof row.link !== "string") return null;
          return {
            title: row.title,
            link: row.link,
            snippet: typeof row.snippet === "string" ? row.snippet : null,
            date: typeof row.date === "string" ? row.date : null,
            source: typeof row.source === "string" ? row.source : null,
            position: typeof row.position === "number" ? row.position : null,
            imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : typeof row.thumbnail === "string" ? row.thumbnail : null,
          };
        }).filter((item): item is WebSearchResult => Boolean(item));
        return {
          items,
          searchParameters: data.searchParameters && typeof data.searchParameters === "object"
            ? data.searchParameters as Record<string, unknown>
            : undefined,
          creditsUsed: typeof data.credits === "number" ? data.credits : null,
        };
      } catch (error) {
        lastError = error;
        const retryable = error instanceof WebSearchProviderError
          ? error.retryable
          : error instanceof Error && (error.name === "TimeoutError" || /fetch|network|timeout/i.test(error.message));
        if (!retryable || attempt === 2) break;
        await delay(250 * 2 ** attempt);
      }
    }
    if (lastError instanceof WebSearchProviderError) throw lastError;
    throw new WebSearchProviderError(
      lastError instanceof Error ? `La fuente web no respondió: ${lastError.message}` : "La fuente web no respondió",
      "unavailable",
      true,
    );
  }
}

export const webSearchClient = new WebSearchClient();
