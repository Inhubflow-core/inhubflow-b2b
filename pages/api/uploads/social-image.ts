import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
};

const ALLOWED_MIME_PREFIXES = ["image/jpeg", "image/png", "image/webp", "image/jpg"];

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET: Servir la imagen subida directamente con su Content-Type correcto
  if (req.method === "GET") {
    try {
      const rawFile = (req.query.file || req.query.name) as string;
      if (!rawFile || typeof rawFile !== "string") {
        return res.status(400).json({ error: "Parámetro 'file' obligatorio" });
      }

      // Prevenir directory traversal
      const safeFilename = path.basename(rawFile.replace(/^\/uploads\/social-posts\//, ""));

      // Ubicaciones posibles
      const primaryPath = path.join(process.cwd(), "public", "uploads", "social-posts", safeFilename);
      const fallbackDataPath = path.join("/data", "uploads", "social-posts", safeFilename);

      let targetPath = "";
      if (fs.existsSync(primaryPath)) {
        targetPath = primaryPath;
      } else if (fs.existsSync(fallbackDataPath)) {
        targetPath = fallbackDataPath;
      } else {
        return res.status(404).json({ error: "Imagen no encontrada" });
      }

      const fileBuffer = fs.readFileSync(targetPath);
      const mime = getMimeType(targetPath);

      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      return res.send(fileBuffer);
    } catch (err: any) {
      console.error("[social-image GET] Error sirviendo imagen:", err);
      return res.status(500).json({ error: "Error al servir la imagen" });
    }
  }

  // POST: Subir imagen
  if (req.method === "POST") {
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

      if (
        !ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) &&
        ![".png", ".jpg", ".jpeg", ".webp"].includes(ext)
      ) {
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

      // Retornar la URL servida por la API para evitar 404 estático en Next.js
      const publicApiUrl = `/api/uploads/social-image?file=${safeFilename}`;

      return res.status(200).json({
        ok: true,
        url: publicApiUrl,
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

  return res.status(405).json({ error: "Método no permitido" });
}
