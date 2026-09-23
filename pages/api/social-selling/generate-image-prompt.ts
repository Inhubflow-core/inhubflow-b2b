import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDb } from "@/lib/db";

const CANDIDATE_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL.trim()] : []),
].filter(Boolean) as string[];

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

  const { post_content, topic } = req.body;
  if (!post_content || typeof post_content !== "string" || !post_content.trim()) {
    return res.status(400).json({ error: "El contenido del post es obligatorio para diseñar el prompt de la imagen" });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: "Falta GEMINI_API_KEY en variables de entorno" });
  }

  const db = getDb();
  let companyContext = "";
  try {
    const ownerId = (session.user as any)?.id;
    let agent: any = null;
    if (ownerId) {
      agent = db.prepare("SELECT company_name, value_proposition FROM sdr_agents WHERE owner_id = ? LIMIT 1").get(ownerId);
    }
    if (!agent) {
      agent = db.prepare("SELECT company_name, value_proposition FROM sdr_agents LIMIT 1").get();
    }
    if (agent?.company_name) {
      companyContext = `Company: ${agent.company_name}. Value proposition: ${agent.value_proposition || ""}`;
    }
  } catch (err) {
    // ignore
  }

  const prompt = `You are a world-class art director and visual designer for high-performing LinkedIn content.
Read the following LinkedIn post written by the user and design a single, powerful photographic image prompt in English for text-to-image generators like Midjourney, Flux, or DALL-E 3.

POST TO VISUALIZE:
"""
${post_content.trim().slice(0, 3000)}
"""

${companyContext ? `BUSINESS CONTEXT: ${companyContext}` : ""}
${topic ? `TOPIC: ${topic}` : ""}

STRICT CREATIVE GUIDELINES:
1. Editorial Photographic Style: High-end editorial photography, cinematic lighting, modern corporate or tech aesthetics, natural textures, shot on 35mm lens, photorealistic, 8k resolution, elegant color grading.
2. Conceptual Match: The visual must capture the core metaphor, human emotion, or industry insight of the post. Avoid cheesy stock photos or people pointing at generic charts.
3. MANDATORY FORMAT & ASPECT RATIO:
   The image size and aspect ratio MUST ALWAYS be 4:3.
   You MUST end the prompt explicitly with: "aspect ratio 4:3, format 4:3 --ar 4:3".
4. OUTPUT FORMAT:
   Return ONLY the final prompt in English. Do not write introductory words, explanations, or quotes.`;

  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    let rawOutput = "";
    let lastError: unknown = null;

    for (const model of STABLE_MODELS) {
      try {
        const result = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.7,
            maxOutputTokens: 600,
          },
        });

        const text = result.text?.trim()?.replace(/^```markdown|^```|```$/g, "").trim();
        if (text && text.length > 20) {
          rawOutput = text;
          break;
        }
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (!rawOutput) {
      rawOutput = `A high-end cinematic editorial photograph representing "${topic || "B2B growth and technology"}", minimalist modern office, soft volumetric lighting, shot on 35mm lens, photorealistic, 8k resolution, elegant color grading`;
    }

    // Normalizar para garantizar siempre 4:3
    let imagePrompt = rawOutput
      .replace(/^["']|["']$/g, "")
      .replace(/--ar\s+\d+:\d+/gi, "")
      .replace(/aspect ratio\s+\d+:\d+/gi, "")
      .replace(/,\s*$/, "")
      .trim();

    imagePrompt = `${imagePrompt}, aspect ratio 4:3 --ar 4:3`;

    return res.status(200).json({
      success: true,
      image_prompt: imagePrompt,
    });
  } catch (error) {
    console.error("[api/social-selling/generate-image-prompt] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al generar el prompt de la imagen",
    });
  }
}
