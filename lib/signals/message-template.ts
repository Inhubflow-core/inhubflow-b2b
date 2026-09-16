import type { SignalMessageConfig, SignalMonitor } from "./schema";

export interface SignalMessageLead {
  full_name: string;
  company?: string | null;
  headline?: string | null;
  signal_type?: string;
  signal_snippet?: string | null;
}

export function parseSignalMessageConfig(monitor: Pick<SignalMonitor, "message_config_json">): SignalMessageConfig {
  try {
    return monitor.message_config_json ? JSON.parse(monitor.message_config_json) as SignalMessageConfig : {};
  } catch {
    return {};
  }
}

function fillTemplate(template: string, lead: SignalMessageLead, topic: string, competitor: string): string {
  const firstName = lead.full_name.split(/\s+/)[0] || "Hola";
  return template
    .replace(/\{first_name\}/gi, firstName)
    .replace(/\{company\}/gi, lead.company || "tu empresa")
    .replace(/\{topic\}/gi, topic)
    .replace(/\{competitor\}/gi, competitor);
}

export function deterministicAntiStalkerMessage(
  monitor: Pick<SignalMonitor, "type" | "competitor_name" | "keywords_json" | "message_config_json">,
  lead: SignalMessageLead,
): string {
  const config = parseSignalMessageConfig(monitor as Pick<SignalMonitor, "message_config_json">);
  const firstName = lead.full_name.split(/\s+/)[0] || "Hola";
  const company = lead.company || "tu empresa";
  let keywords: string[] = [];
  try { keywords = monitor.keywords_json ? JSON.parse(monitor.keywords_json) as string[] : []; } catch {}
  const topic = keywords[0] || "prospección B2B";
  const competitor = monitor.competitor_name || "soluciones del sector";
  if (config.custom_template?.trim()) {
    return fillTemplate(config.custom_template.trim(), lead, topic, competitor);
  }

  const objective = config.objective || "conversation";
  const tone = config.tone || "consultive";
  const isRole = ["new_in_role", "job_changes", "internal_promotion"].includes(monitor.type);
  const isGrowth = ["hiring_spree", "company_growth"].includes(monitor.type);
  const language = config.language || "es";
  let message: string;

  if (language === "en") {
    if (objective === "demo") message = `Hi ${firstName}, teams like ${company} often look for practical ways to improve ${topic}. Would a brief 10-minute overview be useful?`;
    else if (objective === "resource") message = `Hi ${firstName}, ${topic} seems relevant to your role. We prepared a practical B2B guide. Would you like me to share it here?`;
    else message = `Hi ${firstName}, how is ${company} approaching ${topic} today? I would be glad to connect and exchange practical ideas.`;
  } else if (language === "pt-BR") {
    if (objective === "demo") message = `Olá ${firstName}, equipes como a ${company} costumam buscar formas práticas de melhorar ${topic}. Faria sentido ver uma demonstração breve de 10 minutos?`;
    else if (objective === "resource") message = `Olá ${firstName}, ${topic} parece relevante para sua área. Preparamos um guia B2B prático. Posso compartilhar por aqui?`;
    else message = `Olá ${firstName}, como a ${company} está trabalhando ${topic} atualmente? Gostaria de conectar e trocar ideias práticas.`;
  } else if (isRole) {
    message = objective === "demo"
      ? `Hola ${firstName}, felicidades por tu nueva etapa en ${company}. En los primeros meses suele ser clave acelerar resultados comerciales. ¿Te gustaría ver en 10 minutos un enfoque práctico para hacerlo?`
      : `Hola ${firstName}, felicidades por tu nueva etapa en ${company}. ¿Están revisando cómo escalar la prospección comercial durante estos primeros meses? Me gustaría conectar e intercambiar ideas.`;
  } else if (isGrowth) {
    message = objective === "demo"
      ? `Hola ${firstName}, enhorabuena por el crecimiento de ${company}. Cuando el equipo comercial se expande, reducir la curva de aprendizaje suele ser prioritario. ¿Te interesaría ver una demo breve de nuestro enfoque?`
      : `Hola ${firstName}, enhorabuena por el crecimiento de ${company}. ¿Cómo están organizando la prospección y el onboarding del equipo comercial en esta etapa? Me gustaría conectar.`;
  } else if (objective === "resource") {
    message = `Hola ${firstName}, veo que ${topic} es relevante para tu área. Preparamos una guía práctica con ideas aplicables a equipos B2B. ¿Te gustaría que te la comparta por aquí?`;
  } else if (objective === "demo") {
    message = `Hola ${firstName}, trabajo con equipos que buscan mejorar ${topic} sin aumentar la carga operativa. ¿Tendrías 10 minutos esta semana para ver una demostración breve?`;
  } else if (tone === "direct") {
    message = `Hola ${firstName}, ¿cómo están gestionando actualmente ${topic} en ${company}? Me gustaría conectar y compartir algunas ideas concretas.`;
  } else if (tone === "professional") {
    message = `Hola ${firstName}, sigo el trabajo de ${company} y me gustaría conectar para intercambiar buenas prácticas sobre ${topic}.`;
  } else {
    message = `Hola ${firstName}, veo que ${topic} es un tema relevante para equipos como el de ${company}. ¿Cómo lo están abordando actualmente? Me encantaría conectar.`;
  }

  const maxWords = Math.max(20, Math.min(config.max_words || 90, 180));
  const words = message.split(/\s+/);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : message;
}

export function previewSignalMessage(input: {
  signalType: string;
  objective: "conversation" | "demo" | "resource";
  tone: "consultive" | "professional" | "direct";
  competitor?: string;
  keywords?: string[];
  customTemplate?: string;
  language?: "es" | "en" | "pt-BR";
  maxWords?: number;
}): string {
  return deterministicAntiStalkerMessage({
    type: input.signalType as SignalMonitor["type"],
    competitor_name: input.competitor || null,
    keywords_json: JSON.stringify(input.keywords || []),
    message_config_json: JSON.stringify({
      objective: input.objective,
      tone: input.tone,
      custom_template: input.customTemplate,
      language: input.language || "es",
      max_words: input.maxWords || 90,
    }),
  }, {
    full_name: "Martín Echavarría",
    company: "Grupo Retail B2B",
    headline: "Director Comercial & Alianzas",
    signal_type: input.signalType,
  });
}

const STALKER_PATTERNS = [
  /vi que (le|diste|hiciste) (like|me gusta|reacci[oó]n)/i,
  /vi que comentaste en (el|un) post de/i,
  /estuve monitoreando/i,
  /te estamos rastreando/i,
  /observ[eé] que visitas?te/i,
];

export function validateAntiStalkerMessage(message: string): { valid: boolean; reasons: string[] } {
  const reasons = STALKER_PATTERNS.filter((pattern) => pattern.test(message)).map(() => "reveals_tracking_signal");
  if (message.trim().length < 20) reasons.push("message_too_short");
  if (message.length > 2_000) reasons.push("message_too_long");
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}
