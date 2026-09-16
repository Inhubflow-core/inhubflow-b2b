import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";
import type { SignalType } from "./schema";

const PlanSchema = z.object({
  signal_type: z.enum(["keyword_intent", "active_poster", "new_in_role", "internal_promotion", "hiring_spree", "company_growth", "profile_viewers"]),
  monitor_name: z.string().min(1).max(120),
  keywords: z.array(z.string().min(1).max(100)).min(1).max(10),
  titles: z.array(z.string().min(1).max(100)).max(15),
  locations: z.array(z.string().min(1).max(100)).max(10),
  company_sizes: z.array(z.string().min(1).max(50)).max(10),
  exclusions: z.array(z.string().min(1).max(100)).max(10),
  time_window_days: z.number().int().min(1).max(365),
});

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    signal_type: { type: Type.STRING, enum: ["keyword_intent", "active_poster", "new_in_role", "internal_promotion", "hiring_spree", "company_growth", "profile_viewers"] },
    monitor_name: { type: Type.STRING },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    titles: { type: Type.ARRAY, items: { type: Type.STRING } },
    locations: { type: Type.ARRAY, items: { type: Type.STRING } },
    company_sizes: { type: Type.ARRAY, items: { type: Type.STRING } },
    exclusions: { type: Type.ARRAY, items: { type: Type.STRING } },
    time_window_days: { type: Type.NUMBER },
  },
  required: ["signal_type", "monitor_name", "keywords", "titles", "locations", "company_sizes", "exclusions", "time_window_days"],
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
  model: string;
}

export async function planSignalResearch(query: string): Promise<SignalResearchPlan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Ask AI requiere que el proveedor SDR IA esté configurado");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.7-flash";
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 25_000 } });
  const response = await client.models.generateContent({
    model,
    contents: JSON.stringify({ user_query: query }),
    config: {
      systemInstruction: `Convierte la consulta del usuario en un plan de búsqueda real de señales de LinkedIn.
No inventes resultados ni nombres de personas. Sólo define filtros.
Elige keyword_intent para publicaciones con dolor/compra, active_poster para autores recientes, new_in_role/internal_promotion para cambios profesionales, hiring_spree/company_growth para empresas, y profile_viewers sólo si se solicita explícitamente.
Conserva keywords útiles y separa cargos, ubicaciones, tamaños y exclusiones.`,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 1_000,
    },
  });
  if (!response.text) throw new Error("Ask AI no pudo interpretar la consulta");
  const parsed = PlanSchema.parse(JSON.parse(response.text));
  return {
    signalType: parsed.signal_type,
    monitorName: parsed.monitor_name,
    keywords: parsed.keywords,
    titles: parsed.titles,
    locations: parsed.locations,
    companySizes: parsed.company_sizes,
    exclusions: parsed.exclusions,
    timeWindowDays: parsed.time_window_days,
    model: response.modelVersion || model,
  };
}
