import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};

const ALLOWED_MIME_PREFIXES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
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

    const mime = (contentType || "").toLowerCase();
    const ext = path.extname(filename).toLowerCase() || ".png";

    if (!ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) && ![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      return res.status(400).json({
        error: "Formato no válido. Solo se permiten imágenes JPG, PNG o WEBP.",
      });
    }

    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");

    if (buffer.length === 0) {
      return res.status(400).json({ error: "La imagen está vacía" });
    }

    // Carpeta destino en public/uploads/social-posts
    let uploadDir = path.join(process.cwd(), "public", "uploads", "social-posts");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const sanitizedBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40);
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const safeFilename = `${sanitizedBase}-${uniqueSuffix}${ext}`;
    const targetFilePath = path.join(uploadDir, safeFilename);

    fs.writeFileSync(targetFilePath, buffer);

    // Espejo en /data para persistencia en contenedores Docker/Coolify si existe
    if (fs.existsSync("/data")) {
      try {
        const dataDir = path.join("/data", "uploads", "social-posts");
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, safeFilename), buffer);
      } catch {
        // Ignorar si no tiene permisos
      }
    }

    const publicUrl = `/uploads/social-posts/${safeFilename}`;

    return res.status(200).json({
      ok: true,
      url: publicUrl,
      filename: safeFilename,
      size: buffer.length,
    });
  } catch (error: any) {
    console.error("[upload-social-image] Error:", error);
    return res.status(500).json({
      error: error?.message || "Error al subir la imagen",
    });
  }
}
