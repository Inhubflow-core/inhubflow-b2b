import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";

const CANDIDATE_MODELS = [
  // Priorizar modelos estables que no sufren spikes de demanda
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL.trim()] : []),
].filter(Boolean) as string[];

// Evitar modelos problemáticos o saturados conocidos
const STABLE_MODELS = Array.from(new Set(CANDIDATE_MODELS)).filter(
  (m) => m !== "gemini-3.8-flash" && m !== "gemini-flash-latest" && m !== "gemini-3.7-flash"
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  const {
    original_text,
    original_author,
    topic,
    custom_instruction,
    language = "es",
    account_id,
  } = req.body;

  if (!original_text || typeof original_text !== "string" || !original_text.trim()) {
    return res.status(400).json({ error: "El texto del post original es obligatorio para modelar" });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: "Falta GEMINI_API_KEY en variables de entorno" });
  }

  const db = getDb();

  // 1. Obtener contexto de la empresa desde el SDR (aislado por workspace/owner)
  let companyContext = "";
  try {
    const ownerId = (session.user as any)?.id;
    let agent: any = null;
    if (account_id) {
      const acc = db.prepare("SELECT owner_id FROM accounts WHERE id = ?").get(account_id) as any;
      if (acc?.owner_id) {
        agent = db.prepare("SELECT company_name, value_proposition, icp_summary, persona_prompt FROM sdr_agents WHERE owner_id = ? LIMIT 1").get(acc.owner_id);
      }
    }
    if (!agent && ownerId) {
      agent = db.prepare("SELECT company_name, value_proposition, icp_summary, persona_prompt FROM sdr_agents WHERE owner_id = ? LIMIT 1").get(ownerId);
    }
    if (!agent) {
      agent = db.prepare("SELECT company_name, value_proposition, icp_summary, persona_prompt FROM sdr_agents LIMIT 1").get();
    }

    if (agent) {
      companyContext += `Empresa: ${agent.company_name || ""}\n`;
      if (agent.value_proposition) companyContext += `Propuesta de valor: ${agent.value_proposition}\n`;
      if (agent.icp_summary) companyContext += `Cliente ideal: ${agent.icp_summary}\n`;
    }

    const sources = (ownerId
      ? db.prepare("SELECT title, content FROM sdr_knowledge_sources WHERE status = 'active' AND (owner_id = ? OR owner_id IS NULL) LIMIT 3").all(ownerId)
      : db.prepare("SELECT title, content FROM sdr_knowledge_sources WHERE status = 'active' LIMIT 3").all()) as Array<{ title: string; content?: string }>;

    if (sources && sources.length > 0) {
      companyContext += "\nConocimiento clave de la empresa:\n" + sources.map(s => `- ${s.title}: ${s.content?.slice(0, 300) || ""}`).join("\n");
    }
  } catch (dbErr) {
    console.warn("[api/social-selling/model] Error cargando sdr context:", dbErr);
  }

  const langDirectives: Record<string, string> = {
    pt: "ESCREVA O POST 100% EM PORTUGUÊS (BR) NATIVO.",
    en: "WRITE THE POST 100% IN NATIVE, ENGAGING PROFESSIONAL ENGLISH.",
    es: "ESCRIBE EL POST 100% EN ESPAÑOL NATIVO Y PROFESIONAL.",
  };

  const selectedLang = language === "pt" || language === "pt-BR" ? "pt" : language === "en" ? "en" : "es";

  const prompt = `Eres un creador de contenido de élite y estratega de Social Selling en LinkedIn B2B.
Tu misión es MODELAR un post viral de LinkedIn para crear una publicación 100% ORIGINAL, de alta autoridad y orientada a atracción de clientes.

NO DEBES COPIAR NI PLAGIAR. Debes tomar la esencia psicológica, la estructura narrativa y el ángulo del post original, pero reescribirlo desde la perspectiva de nuestra empresa y propuesta de valor.

ESTRUCTURA EXACTA DEL POST A MODELAR:
1. [EL GANCHO / HOOK (Líneas 1 y 2)]:
   - Frase corta, magnética e intrigante que obligue a hacer clic en "...ver más" (sin clickbait barato).
2. [EL DESARROLLO / LA HISTORIA O FRAMEWORK]:
   - Párrafos muy cortos (1 a 2 oraciones máximo por párrafo) con saltos de línea para dar respiración visual móvil.
   - Comparte una lección real, un contraste común ("la mayoría cree X, pero la realidad es Y") o un error que comete la industria.
3. [EL PUENTE DE VALOR]:
   - Conecta con la perspectiva de nuestra empresa (${companyContext || "eficiencia operativa, automatización de ventas B2B y estrategia inteligente"}) como la solución lógica y madura a ese dilema, sin sonar a anuncio publicitario.
4. [EL LLAMADO A LA ACCIÓN (CTA)]:
   - Termina con un llamado a la acción claro que genere conversación o leads por mensaje directo (ej: "Comenta [PALABRA] y te comparto el playbook", "¿Cómo lo gestionan en tu empresa?", etc.).
5. [HASHTAGS DISCRETOS]:
   - Máximo 3 hashtags relevantes al final.

DIRETIVA DE IDIOMA CRÍTICA:
${langDirectives[selectedLang]}

${custom_instruction ? `INSTRUCCIÓN PERSONALIZADA DEL USUARIO: ${custom_instruction}` : ""}

POST ORIGINAL DE REFERENCIA (${original_author || "Líder de industria"}):
"""
${original_text.slice(0, 2000)}
"""

REGLA DE FORMATO DE SALIDA:
Primero escribe el texto completo del post para LinkedIn.
Luego, en una línea separada al final, incluye un prompt fotográfico profesional en inglés para generar una imagen impactante que acompañe el post en herramientas como Midjourney o Flux.

REGLA OBLIGATORIA DE TAMAÑO / PROPORCIÓN DE IMAGEN:
El tamaño y relación de aspecto de la imagen DEBE ser SIEMPRE 4:3 por defecto.
En el prompt en inglés DEBES incluir obligatoriamente al final: "aspect ratio 4:3, format 4:3 --ar 4:3".

Delimita el prompt de imagen exactamente con estos marcadores:
<<<IMAGE_PROMPT>>>
[Aquí el prompt de imagen en inglés: fotografía editorial, iluminación cinematográfica, estética corporativa moderna o minimalista, hiperrealista, 35mm lens, aspect ratio 4:3 --ar 4:3]
<<<END_IMAGE_PROMPT>>>

Sin notas introductorias ni encabezados tipo "Aquí tienes el post:".`;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    let lastError: unknown = null;
    let rawOutput = "";
    let usedModel = "";

    for (const model of STABLE_MODELS) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.72,
            maxOutputTokens: 2500,
          },
        });

        const text = res.text?.trim()?.replace(/^```markdown|^```|```$/g, "").trim();
        if (text && text.length > 50) {
          rawOutput = text;
          usedModel = model;
          break;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[api/social-selling/model] Modelo ${model} no disponible, intentando siguiente:`, err?.message || err);
        // Espera de 300ms antes del siguiente modelo
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    if (!rawOutput) {
      let errMsg = "El servicio de IA está experimentando alta demanda. Por favor reintenta en unos instantes.";
      if (lastError instanceof Error) {
        try {
          const parsed = JSON.parse(lastError.message);
          if (parsed?.error?.message) {
            errMsg = parsed.error.message;
          }
        } catch {
          errMsg = lastError.message;
        }
      }
      throw new Error(errMsg);
    }

    // Extraer image_prompt de los delimitadores
    let imagePrompt = "";
    const promptMatch = rawOutput.match(/<<<IMAGE_PROMPT>>>([\s\S]*?)<<<END_IMAGE_PROMPT>>>/);
    if (promptMatch && promptMatch[1]) {
      imagePrompt = promptMatch[1].trim();
    }

    // Limpiar el texto del post quitando los delimitadores
    const cleanedPost = rawOutput
      .replace(/<<<IMAGE_PROMPT>>>[\s\S]*?<<<END_IMAGE_PROMPT>>>/g, "")
      .trim();

    // Normalizar y forzar SIEMPRE la proporción 4:3 por defecto
    if (imagePrompt) {
      imagePrompt = imagePrompt.replace(/--ar\s+\d+:\d+/gi, "").trim();
      imagePrompt = imagePrompt.replace(/aspect ratio\s+\d+:\d+/gi, "").trim();
      imagePrompt = imagePrompt.replace(/,\s*$/, "").trim();
      imagePrompt = `${imagePrompt}, aspect ratio 4:3 --ar 4:3`;
    } else {
      imagePrompt = `A high-end cinematic editorial photograph of a business leader and modern technology setup, representing "${topic || "B2B growth"}", minimalist modern office, soft volumetric lighting, shot on 35mm lens, photorealistic, 8k resolution, elegant color grading, aspect ratio 4:3 --ar 4:3`;
    }

    // Extraer título/primer gancho para resumen
    const firstLine = cleanedPost.split("\n")[0]?.replace(/^[#*\s-]+/, "").slice(0, 90) || topic || "Publicación de Social Selling";

    return res.status(200).json({
      title: firstLine,
      content: cleanedPost,
      image_prompt: imagePrompt,
      model_used: usedModel,
      topic: topic || null,
      original_author: original_author || null,
    });
  } catch (error: any) {
    console.error("[api/social-selling/model] Error generating post:", error);
    return res.status(500).json({
      error: error?.message || "Error modelando la publicación con IA",
    });
  }
}
