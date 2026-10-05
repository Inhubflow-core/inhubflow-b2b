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

function cleanFirstName(fullName: string): string {
  const first = (fullName || "").trim().split(/\s+/)[0] || "";
  if (/^(usu[aá]rio|usuario|linkedin|miembro|member)$/i.test(first)) {
    return "";
  }
  return first;
}

function fillTemplate(template: string, lead: SignalMessageLead, topic: string, competitor: string): string {
  const firstName = cleanFirstName(lead.full_name) || "Hola";
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
  const rawFirst = cleanFirstName(lead.full_name);
  const firstName = rawFirst || "";
  const company = lead.company || "tu empresa";  let keywords: string[] = [];
  try { keywords = monitor.keywords_json ? JSON.parse(monitor.keywords_json) as string[] : []; } catch {}
  let topic = keywords[0];
  if (!topic && lead.signal_snippet) {
    const quoteMatch = lead.signal_snippet.match(/[“"]([^”"]+)[”"]/);
    if (quoteMatch) {
      const rawQuote = quoteMatch[1]
        .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "")
        .replace(/^(an[uú]ncio\s+importante|atenci[oó]n|urgente|comunicado|aviso|noticia)[:!\s]*/i, "")
        .trim();
      const words = rawQuote.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
      if (words.length > 3) topic = words;
    }
  }
  if (!topic && monitor.competitor_name) {
    topic = monitor.competitor_name;
  }
  if (!topic) {
    topic = "innovación y desarrollo B2B";
  }
  const competitor = monitor.competitor_name || "soluciones del sector";
  if (config.custom_template?.trim()) {
    return fillTemplate(config.custom_template.trim(), lead, topic, competitor);
  }

  const objective = config.objective || "conversation";
  const tone = config.tone || "consultive";
  const isRole = ["new_in_role", "job_changes", "internal_promotion"].includes(monitor.type);
  const isGrowth = ["hiring_spree", "company_growth"].includes(monitor.type);
  const isPostEngagement = ["post_engagement", "high_intent_comments", "competitor_reactions"].includes(monitor.type);
  const language = config.language || "es";
  let message: string;

  if (language === "en") {
    if (objective === "demo") {
      if (tone === "direct") message = `Hey ${firstName}! Looks like ${topic} is big for ${company} right now. We have a super agile setup for this. Up for a quick 10-minute chat this week?`;
      else if (tone === "professional") message = `Dear ${firstName}, I assist leaders optimizing ${topic} across your industry. Would you have 10 minutes this week for a brief corporate overview?`;
      else message = `Hi ${firstName}, teams like ${company} often look for strategic ways to improve ${topic}. Would a brief 10-minute consultation be useful?`;
    } else if (objective === "resource") {
      if (tone === "direct") message = `Hey ${firstName}! Saw ${topic} is gaining traction. We put together a no-fluff, hands-on guide about this. Mind if I send it over here?`;
      else if (tone === "professional") message = `Dear ${firstName}, we compiled a technical benchmark report regarding ${topic} for organizations like ${company}. Please let me know if you would like to review it.`;
      else message = `Hi ${firstName}, ${topic} seems relevant to your current focus. We prepared a practical B2B guide with industry lessons. Would you like me to share it here?`;
    } else {
      if (tone === "direct") message = `Hey ${firstName}! Great to connect. Really like what you're driving at ${company} around ${topic}. Let's connect and catch up!`;
      else if (tone === "professional") message = `Dear ${firstName}, I follow ${company}'s progress closely in ${topic}. I would welcome the opportunity to connect and exchange professional insights.`;
      else message = `Hi ${firstName}, ${topic} is becoming quite relevant across the sector. How is ${company} approaching this challenge currently? Would love to connect and exchange perspectives.`;
    }
  } else if (language === "pt-BR") {
    if (objective === "demo") {
      if (tone === "direct") message = `Oi ${firstName}! Vejo que o tema de ${topic} está forte na ${company}. Temos uma solução bem ágil para isso. Topa um café virtual rápido de 10 minutos esta semana?`;
      else if (tone === "professional") message = `Prezado(a) ${firstName}, colaboro com gestores na otimização de ${topic}. Teria 10 minutos esta semana para uma breve demonstração executiva?`;
      else message = `Olá ${firstName}, equipes como a ${company} costumam buscar formas estratégicas de aprimorar ${topic}. Faria sentido uma breve sessão consultiva de 10 minutos?`;
    } else if (objective === "resource") {
      if (tone === "direct") message = `Oi ${firstName}! Preparamos um material direto ao ponto sobre ${topic}. Quer que eu compartilhe por aqui?`;
      else if (tone === "professional") message = `Prezado(a) ${firstName}, elaboramos um estudo técnico sobre ${topic} aplicável à ${company}. Fico à disposição caso deseje recebê-lo.`;
      else message = `Olá ${firstName}, ${topic} parece muito relevante para a sua área. Preparamos um guia B2B com boas práticas. Posso compartilhar por aqui?`;
    } else {
      if (tone === "direct") message = `Oi ${firstName}! Que bom te encontrar por aqui. Parabéns pelas iniciativas na ${company} com ${topic}. Vamos nos conectar!`;
      else if (tone === "professional") message = `Prezado(a) ${firstName}, acompanho com atenção a atuação da ${company} em ${topic}. Gostaria de conectar para compartilhar visões de mercado.`;
      else message = `Olá ${firstName}, como a ${company} está trabalhando ${topic} atualmente? Gostaria de conectar e trocar ideias práticas.`;
    }
  } else if (monitor.type === "funding_round") {
    if (objective === "demo") {
      if (tone === "direct") message = `¡Hola ${firstName}! ¡Tremenda noticia la ronda de ${company}! Para escalar rápido sin enredar al equipo, tenemos algo muy práctico. ¿Te cuadra un café virtual rápido de 10 min?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, le felicito por la ronda de capital de ${company}. Si evalúan optimizar la infraestructura de prospección comercial, quedo a su disposición para una breve presentación.`;
      else message = `Hola ${firstName}, felicidades por la ronda anunciada por ${company}. En etapas de expansión suele ser clave escalar el pipeline sin aumentar la carga operativa. ¿Te gustaría ver un enfoque práctico en 10 minutos?`;
    } else {
      if (tone === "direct") message = `¡Hola ${firstName}! Felicitaciones por el hito de inversión en ${company}. ¡Mucho éxito en esta etapa! Conectemos por aquí para charlar cuando gustes.`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, mis felicitaciones por el financiamiento obtenido por ${company}. Me pongo a su disposición para intercambiar perspectivas de crecimiento en el sector.`;
      else message = `Hola ${firstName}, felicidades por la ronda anunciada por ${company}. ¿Cómo están pensando escalar la generación de oportunidades en esta nueva etapa? Me gustaría conectar.`;
    }
  } else if (isRole) {
    if (objective === "demo") {
      if (tone === "direct") message = `¡Hola ${firstName}! ¡Muchos éxitos en tu nuevo rol en ${company}! Cuando te acomodes un poco, ¿te cuadra una charla rápida de 10 min para ver cómo podemos sumar a tus metas comerciales?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, le felicito por su reciente nombramiento en ${company}. Si entre sus prioridades está acelerar resultados comerciales, ¿dispondría de 10 minutos para una breve sesión informativa?`;
      else message = `Hola ${firstName}, felicidades por tu nueva etapa en ${company}. En los primeros meses suele ser clave acelerar resultados comerciales sin fricción. ¿Te gustaría ver en 10 minutos un enfoque práctico para lograrlo?`;
    } else if (objective === "resource") {
      if (tone === "direct") message = `¡Hola ${firstName}! Felicitaciones por el nuevo cargo en ${company}. Armamos un checklist express con las prioridades de otros líderes en sus primeros meses. ¿Te lo paso?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, enhorabuena por su nuevo nombramiento en ${company}. Hemos preparado un informe técnico para líderes en sus primeros 90 días. Quedo a su disposición si desea recibirlo.`;
      else message = `Hola ${firstName}, felicidades por tu nombramiento en ${company}. Preparamos un recurso con las prioridades clave de líderes del sector en sus primeros 90 días. ¿Te gustaría que te lo comparta?`;
    } else {
      if (tone === "direct") message = `¡Hola ${firstName}! ¡Felicitaciones por asumir el rol en ${company}! Muy buena trayectoria. Conectemos por aquí para estar en contacto y charlar cuando gustes.`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, le felicito por su designación en ${company}. Me pongo a su entera disposición y le invito a conectar para compartir buenas prácticas profesionales.`;
      else message = `Hola ${firstName}, felicidades por tu nueva etapa en ${company}. ¿Cómo visualizas los principales retos de tu área durante estos primeros meses? Me gustaría conectar e intercambiar ideas.`;
    }
  } else if (isGrowth) {
    if (objective === "demo") {
      if (tone === "direct") message = `¡Hola ${firstName}! ¡Qué buen ritmo de crecimiento lleva ${company}! Escalar equipo es genial pero retador. ¿Te hace sentido un café virtual rápido de 10 min para ver cómo ayudamos a simplificar la prospección?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, felicitaciones por el crecimiento de ${company}. Si buscan mantener la eficiencia operativa mientras expanden equipo comercial, me complacería coordinar una breve demostración corporativa.`;
      else message = `Hola ${firstName}, enhorabuena por el crecimiento de ${company}. Al expandir equipo comercial, reducir la curva de aprendizaje suele ser prioritario. ¿Te interesaría ver una demo breve de 10 minutos de nuestro enfoque?`;
    } else if (objective === "resource") {
      if (tone === "direct") message = `¡Hola ${firstName}! Qué bueno ver el crecimiento de ${company}. Tenemos un resumen express con 3 aprendizajes de otros equipos en plena expansión. ¿Te late que te lo pase por aquí?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, enhorabuena por la expansión de ${company}. Hemos compilado un documento de trabajo sobre mejores prácticas de escalamiento comercial. ¿Desea que se lo comparta?`;
      else message = `Hola ${firstName}, felicidades por la expansión de ${company}. Preparamos una guía con aprendizajes clave para equipos comerciales en fase de crecimiento. ¿Te gustaría que te la comparta?`;
    } else {
      if (tone === "direct") message = `¡Hola ${firstName}! Veo que están creciendo con todo en ${company}, ¡felicitaciones! Me encantaría conectar por aquí para seguir de cerca lo que están construyendo.`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, sigo con atención la trayectoria de expansión de ${company}. Le invito a conectar para intercambiar visiones sobre escalamiento comercial en el sector.`;
      else message = `Hola ${firstName}, enhorabuena por el crecimiento de ${company}. ¿Cómo están organizando la prospección y el onboarding del equipo comercial en esta etapa? Me gustaría conectar.`;
    }
  } else if (isPostEngagement) {
    if (objective === "resource") {
      if (tone === "direct") message = `¡Hola ${firstName}! Justo vi que el tema de ${topic} viene generando bastante conversación. Armamos una guía súper práctica y al grano sobre esto. ¿Te gustaría que te la pase por aquí?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, sigo de cerca las iniciativas vinculadas a ${topic}. Hemos elaborado un informe técnico y práctico aplicable a organizaciones como ${company}. Quedo a su disposición si desea revisarlo.`;
      else message = `Hola ${firstName}, sigo de cerca el debate sobre ${topic}. En base a las tendencias que vemos en el sector, preparamos un recurso estratégico con aprendizajes aplicables a ${company}. ¿Te interesaría que te lo comparta por aquí?`;
    } else if (objective === "demo") {
      if (tone === "direct") message = `¡Hola ${firstName}! Veo que están muy activos con el tema de ${topic}. Tenemos un modelo bastante ágil para resolver esto en empresas como ${company}. ¿Te cuadra un café virtual rápido de 10 minutos estos días?`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, colaboro con directivos optimizando procesos de ${topic} en su sector. ¿Dispondría de 10 minutos esta semana para evaluar brevemente nuestro enfoque aplicado a ${company}?`;
      else message = `Hola ${firstName}, veo que ${topic} está siendo un punto de inflexión estratégico en el sector. ¿Tendrías 10 minutos esta semana para explorar cómo abordamos este reto en organizaciones como ${company}?`;
    } else {
      if (tone === "direct") message = `¡Hola ${firstName}! Qué bueno coincidir por aquí. Me pareció genial lo que vienen impulsando en ${company} en torno a ${topic}. ¡Conectemos y charlamos un rato!`;
      else if (tone === "professional") message = `Estimado/a ${firstName}, sigo con atención la trayectoria de ${company} en el ámbito de ${topic}. Me pongo en contacto para conectar e intercambiar perspectivas profesionales sobre el sector.`;
      else message = `Hola ${firstName}, veo que ${topic} está cobrando bastante relevancia en el sector. ¿Cómo lo están viviendo y priorizando actualmente en ${company}? Me encantaría conectar e intercambiar visiones.`;
    }
  } else if (objective === "resource") {
    if (tone === "direct") message = `¡Hola ${firstName}! En torno a ${topic} armamos una guía práctica con ideas súper aplicables a empresas como ${company}. ¿Te la paso por aquí?`;
    else if (tone === "professional") message = `Estimado/a ${firstName}, hemos desarrollado un documento de trabajo sobre ${topic} para organizaciones de su sector. Quedo a su disposición si resulta de su interés.`;
    else message = `Hola ${firstName}, veo que ${topic} es relevante para tu área. Preparamos una guía práctica con ideas aplicables a equipos B2B como ${company}. ¿Te gustaría que te la comparta por aquí?`;
  } else if (objective === "demo") {
    if (tone === "direct") message = `¡Hola ${firstName}! Trabajamos ayudando a equipos a resolver ${topic} de forma ágil y sin rodeos. ¿Te cuadra una llamada breve de 10 min para mostrártelo?`;
    else if (tone === "professional") message = `Estimado/a ${firstName}, colaboramos con directivos mejorando la gestión de ${topic} con alta rentabilidad operativa. ¿Tendría 10 minutos esta semana para una sesión demostrativa?`;
    else message = `Hola ${firstName}, trabajo con equipos que buscan mejorar ${topic} sin aumentar la carga operativa. ¿Tendrías 10 minutos esta semana para ver una demostración breve?`;
  } else if (tone === "direct") {
    message = `¡Hola ${firstName}! Qué bueno encontrar tu perfil en ${company}. Me parece muy interesante lo que hacen en ${topic}. ¡Conectemos por aquí!`;
  } else if (tone === "professional") {
    message = `Estimado/a ${firstName}, sigo el desarrollo de ${company} y me gustaría conectar para intercambiar buenas prácticas profesionales sobre ${topic}.`;
  } else {
    message = `Hola ${firstName}, veo que ${topic} es un tema relevante para equipos como el de ${company}. ¿Cómo lo están abordando actualmente? Me encantaría conectar e intercambiar ideas.`;
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
