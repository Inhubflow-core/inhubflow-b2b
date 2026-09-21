import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

const ALLOWED_MIME_PREFIXES = [
  "audio/",
  "image/",
  "video/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "text/",
];

const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".webm", ".flac",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
  ".mp4", ".mov", ".avi", ".mkv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv"
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { filename, contentType, base64 } = req.body as {
      filename?: string;
      contentType?: string;
      base64?: string;
    };

    if (!filename || !base64) {
      return res.status(400).json({ error: "Faltan datos obligatorios (filename, base64)" });
    }

    const ext = path.extname(filename).toLowerCase();
    const mime = (contentType || "").toLowerCase();

    const isAllowedExt = ALLOWED_EXTENSIONS.has(ext);
    const isAllowedMime = ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));

    if (!isAllowedExt && !isAllowedMime) {
      return res.status(400).json({
        error: "Tipo de archivo no permitido. Solo se permiten audios, imágenes, videos, PDFs y documentos."
      });
    }

    // Limpiar base64 si incluye prefijo data URL
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    if (buffer.length === 0) {
      return res.status(400).json({ error: "El archivo está vacío" });
    }

    // Máximo 25 MB
    if (buffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ error: "El archivo supera el límite de 25 MB" });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "workflow-attachments");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const sanitizedBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 50);
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const safeFilename = `${sanitizedBase}-${uniqueSuffix}${ext || ".bin"}`;
    const targetFilePath = path.join(uploadDir, safeFilename);

    fs.writeFileSync(targetFilePath, buffer);

    const publicUrl = `/uploads/workflow-attachments/${safeFilename}`;

    return res.status(200).json({
      ok: true,
      url: publicUrl,
      name: filename,
      type: contentType || (ext.startsWith(".mp3") ? "audio/mp3" : "application/octet-stream"),
      size: buffer.length,
    });
  } catch (error) {
    console.error("[upload-workflow-attachment] Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Error al guardar el archivo adjunto",
    });
  }
}
