import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { SignalType } from "./schema";

const PlanSchema = z.object({
  signal_type: z.enum(["keyword_intent", "active_poster", "new_in_role", "internal_promotion", "hiring_spree", "company_growth", "profile_viewers", "funding_round", "company_news", "acquisition_event", "industry_event"]),
  monitor_name: z.string().min(1).max(120),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(10),
  titles: z.array(z.string().min(1).max(100)).max(15),
  locations: z.array(z.string().min(1).max(100)).max(10),
  company_sizes: z.array(z.string().min(1).max(50)).max(10),
  exclusions: z.array(z.string().min(1).max(100)).max(10),
  time_window_days: z.number().int().min(1).max(365),
  result_limit: z.number().int().min(1).max(100),
  source_strategy: z.enum(["linkedin", "web", "hybrid"]),
  event_kinds: z.array(z.string().min(1).max(80)).max(10),
});

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    signal_type: { type: Type.STRING, enum: ["keyword_intent", "active_poster", "new_in_role", "internal_promotion", "hiring_spree", "company_growth", "profile_viewers", "funding_round", "company_news", "acquisition_event", "industry_event"] },
    monitor_name: { type: Type.STRING },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    titles: { type: Type.ARRAY, items: { type: Type.STRING } },
    locations: { type: Type.ARRAY, items: { type: Type.STRING } },
    company_sizes: { type: Type.ARRAY, items: { type: Type.STRING } },
    exclusions: { type: Type.ARRAY, items: { type: Type.STRING } },
    time_window_days: { type: Type.NUMBER },
    result_limit: { type: Type.NUMBER },
    source_strategy: { type: Type.STRING, enum: ["linkedin", "web", "hybrid"] },
    event_kinds: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["signal_type", "monitor_name", "keywords", "titles", "locations", "company_sizes", "exclusions", "time_window_days", "result_limit", "source_strategy", "event_kinds"],
};

export interface SignalResearchPlan {
  signalType: SignalType;
  monitorName: string;
  keywords: string[];
  titles: string[];
  locations: string[];
  companySizes: string[];
  exclusions: string[];
  timeWindowDays: number;
  resultLimit: number;
  sourceStrategy: "linkedin" | "web" | "hybrid";
  eventKinds: string[];
  model: string;
}

const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/\bceos?\b/i, "CEO"], [/fundadores?|founders?/i, "Founder"],
  [/directores? comerciales?|sales directors?/i, "Director Comercial"],
  [/vp(?: de)? ventas|vp sales/i, "VP Sales"], [/cmos?\b/i, "CMO"],
  [/head of growth/i, "Head of Growth"], [/coos?\b/i, "COO"],
];
const LOCATION_NAMES = ["España", "México", "Colombia", "Argentina", "Chile", "Perú", "Brasil", "Estados Unidos", "USA"];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function deterministicSignalResearchPlan(query: string): SignalResearchPlan {
  const normalized = query.toLowerCase();
  const titles = unique(ROLE_PATTERNS.filter(([pattern]) => pattern.test(query)).map(([, role]) => role));
  const locations = LOCATION_NAMES.filter((location) => normalized.includes(location.toLowerCase()));
  const requested = query.match(/\b(?:encuentra|buscar?|dame|quiero)?\s*(\d{1,3})\b/i);
  const resultLimit = Math.max(1, Math.min(Number(requested?.[1] || 25), 100));
  let signalType: SignalType = "keyword_intent";
  let keywords: string[] = [];
  let window = 30;
  let sourceStrategy: "linkedin" | "web" | "hybrid" = "linkedin";
  let eventKinds: string[] = [];

  if (/ascen(?:d|s)|promov(?:id|er)|promotion/i.test(normalized)) {
    signalType = "internal_promotion";
    keywords = ["ascenso", "promoción", "promoted"];
    window = 90;
  } else if (/nuevo (?:cargo|puesto|rol)|new role|job change|cambiaron de (?:cargo|trabajo)/i.test(normalized)) {
    signalType = "new_in_role";
    keywords = ["nuevo cargo", "new role", "nueva posición"];
    window = 90;
  } else if (/contrat|hiring|vacantes?|empleos?/i.test(normalized)) {
    signalType = "hiring_spree";
    keywords = ["contratando", "vacantes", "hiring"];
    window = 30;
  } else if (/crecimiento|hipercrecimiento|headcount|plantilla/i.test(normalized)) {
    signalType = "company_growth";
    keywords = ["crecimiento", "expansión", "headcount growth"];
    window = 180;
  } else if (/visit(?:aron|antes).*perfil|profile viewers?/i.test(normalized)) {
    signalType = "profile_viewers";
    keywords = ["visitantes del perfil"];
    window = 30;
  } else if (/activ[oa]s?|publicaron|publicaciones recientes|posted recently/i.test(normalized)) {
    signalType = "active_poster";
    keywords = ["actividad reciente"];
    window = 2;
  } else if (/adquiri|adquisici[oó]n|compr[oó] (?:a|la empresa)|acquisition|acquired/i.test(normalized)) {
    signalType = "acquisition_event";
    keywords = ["adquisición", "acquired", "acquisition"];
    eventKinds = ["acquisition"];
    sourceStrategy = "hybrid";
    window = 90;
  } else if (/evento|conferencia|feria|summit|conference|trade show/i.test(normalized)) {
    signalType = "industry_event";
    keywords = ["evento", "conferencia", "summit"];
    eventKinds = ["industry_event"];
    sourceStrategy = "hybrid";
    window = 60;
  } else if (/noticias?|anunci[oó]|lanzamiento|expansi[oó]n|company news/i.test(normalized)) {
    signalType = "company_news";
    keywords = ["anuncio", "lanzamiento", "expansión"];
    eventKinds = ["company_news"];
    sourceStrategy = "hybrid";
    window = 30;
  } else if (/fondos?|inversi[oó]n|ronda|funding|capital/i.test(normalized)) {
    signalType = "funding_round";
    keywords = ["levantó inversión", "ronda de inversión", "funding round", "capital levantado"];
    eventKinds = ["funding_round"];
    sourceStrategy = "hybrid";
    window = 30;
  }

  if (keywords.length === 0) {
    const cleaned = query
      .replace(/\b(encuentra|buscar?|dame|quiero|personas?|empresas?|prospectos?|leads?|\d+)\b/gi, " ")
      .replace(/\s+/g, " ").trim();
    keywords = [cleaned || query.trim()];
  }
  const descriptor = titles[0] || keywords[0];
  return {
    signalType,
    monitorName: `Investigación: ${descriptor}`.slice(0, 120),
    keywords: unique(keywords).slice(0, 10),
    titles,
    locations,
    companySizes: [],
    exclusions: [],
    timeWindowDays: window,
    resultLimit,
    sourceStrategy,
    eventKinds,
    model: "deterministic-fallback",
  };
}

function isTransient(error: unknown): boolean {
  const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: number }).status)
    : 0;
  return status === 429 || status === 503 || text.includes("503") || text.includes("429")
    || text.includes("unavailable") || text.includes("high demand") || text.includes("rate limit")
    || text.includes("resource_exhausted");
}

function modelCandidates(): string[] {
  // gemini-3.7-flash responde 503 "high demand" de forma sostenida, así que ya no
  // forma parte de la cadena por defecto: sólo se usa si alguien lo nombra explícitamente.
  return unique([
    process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
    ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash").split(","),
    "gemini-3.6-flash",
  ]);
}

function mapPlan(parsed: z.infer<typeof PlanSchema>, model: string): SignalResearchPlan {
  return {
    signalType: parsed.signal_type,
    monitorName: parsed.monitor_name,
    keywords: unique(parsed.keywords),
    titles: unique(parsed.titles),
    locations: unique(parsed.locations),
    companySizes: unique(parsed.company_sizes),
    exclusions: unique(parsed.exclusions),
    timeWindowDays: parsed.time_window_days,
    resultLimit: parsed.result_limit,
    sourceStrategy: parsed.source_strategy,
    eventKinds: unique(parsed.event_kinds),
    model,
  };
}

export async function planSignalResearch(query: string): Promise<SignalResearchPlan> {
  const fallback = deterministicSignalResearchPlan(query);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallback;
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 25_000 } });
  let lastError: unknown;

  for (const model of modelCandidates()) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: JSON.stringify({ user_query: query, deterministic_baseline: fallback }),
        config: {
          systemInstruction: `Convierte la consulta del usuario en un plan de búsqueda real de señales de LinkedIn.
No inventes resultados ni nombres de personas. Sólo define filtros.
Elige keyword_intent para publicaciones con dolor o compra; funding_round para inversión/rondas; company_news para anuncios/lanzamientos; acquisition_event para adquisiciones; industry_event para eventos; active_poster para autores recientes; new_in_role/internal_promotion para cambios profesionales; hiring_spree/company_growth para empresas; profile_viewers sólo si se solicita explícitamente.
Usa source_strategy=hybrid para funding/noticias/adquisiciones/eventos, linkedin para señales sociales, y web sólo si el usuario pide expresamente investigación exclusivamente web.
Conserva el número máximo solicitado por el usuario en result_limit (1-100), event_kinds, keywords útiles y separa cargos, ubicaciones, tamaños y exclusiones.`,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
          maxOutputTokens: 1_000,
        },
      });
      if (!response.text) throw new Error("Ask AI no produjo un plan estructurado");
      return mapPlan(PlanSchema.parse(JSON.parse(response.text)), response.modelVersion || model);
    } catch (error) {
      lastError = error;
      console.warn(`[SignalRadar] Planner ${model} no disponible:`, error instanceof Error ? error.message : error);
      if (!isTransient(error)) break;
    }
  }

  console.warn("[SignalRadar] Usando planificador determinista seguro:", lastError instanceof Error ? lastError.message : lastError);
  return fallback;
}
