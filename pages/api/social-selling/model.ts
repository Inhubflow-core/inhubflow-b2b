import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";

const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL?.trim(),
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
].filter(Boolean) as string[];

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
  } = req.body;

  if (!original_text || typeof original_text !== "string" || !original_text.trim()) {
    return res.status(400).json({ error: "El texto del post original es obligatorio para modelar" });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: "Falta GEMINI_API_KEY en variables de entorno" });
  }

  const db = getDb();

  // 1. Obtener contexto de la empresa desde el SDR
  let companyContext = "";
  try {
    const agent = db.prepare("SELECT company_name, value_proposition, icp_summary, persona_prompt FROM sdr_agents LIMIT 1").get() as any;
    if (agent) {
      companyContext += `Empresa: ${agent.company_name || ""}\n`;
      if (agent.value_proposition) companyContext += `Propuesta de valor: ${agent.value_proposition}\n`;
      if (agent.icp_summary) companyContext += `Cliente ideal: ${agent.icp_summary}\n`;
    }

    const sources = db.prepare("SELECT title, content FROM sdr_knowledge_sources WHERE status = 'active' LIMIT 3").all() as Array<{ title: string; content?: string }>;
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

Escribe ÚNICAMENTE el texto final del post listo para publicar en LinkedIn. Sin comillas introductorias, sin notas de autor ni encabezados tipo "Aquí tienes el post:".`;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    let lastError: unknown = null;
    let generatedPost = "";
    let usedModel = "";

    for (const model of CANDIDATE_MODELS) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.75,
            maxOutputTokens: 2500,
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        });

        const text = res.text?.trim()?.replace(/^```markdown|^```|```$/g, "").trim();
        if (text && text.length > 50) {
          generatedPost = text;
          usedModel = model;
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[api/social-selling/model] Modelo ${model} falló, probando alternativa:`, err);
      }
    }

    if (!generatedPost) {
      throw lastError || new Error("No se pudo generar el post con los modelos disponibles");
    }

    // Extraer título/primer gancho para resumen
    const firstLine = generatedPost.split("\n")[0]?.replace(/^[#*\s-]+/, "").slice(0, 90) || topic || "Publicación de Social Selling";

    return res.status(200).json({
      title: firstLine,
      content: generatedPost,
      model_used: usedModel,
      topic: topic || null,
      original_author: original_author || null,
    });
  } catch (error) {
    console.error("[api/social-selling/model] Error generating post:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error modelando la publicación con IA",
    });
  }
}
