import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
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

function isValidImageMagicBytes(buffer: Buffer): { valid: boolean; ext: string; mime: string } {
  if (buffer.length < 12) return { valid: false, ext: "", mime: "" };

  // PNG: 89 50 4E 47 (\x89PNG)
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { valid: true, ext: ".png", mime: "image/png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, ext: ".jpg", mime: "image/jpeg" };
  }

  // WEBP: 'RIFF'....'WEBP'
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { valid: true, ext: ".webp", mime: "image/webp" };
  }

  return { valid: false, ext: "", mime: "" };
}

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
    default:
      return "application/octet-stream";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Exigir sesión activa de usuario para interactuar con el endpoint
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "No autenticado" });
  }

  // GET: Servir la imagen subida con seguridad y headers correctos
  if (req.method === "GET") {
    try {
      const rawFile = (req.query.file || req.query.name) as string;
      if (!rawFile || typeof rawFile !== "string") {
        return res.status(400).json({ error: "Parámetro 'file' obligatorio" });
      }

      // Prevenir directory traversal
      const safeFilename = path.basename(rawFile.replace(/^\/uploads\/social-posts\//, ""));

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
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      return res.send(fileBuffer);
    } catch (err: any) {
      console.error("[social-image GET] Error sirviendo imagen:", err);
      return res.status(500).json({ error: "Error al servir la imagen" });
    }
  }

  // POST: Subir imagen validando tamaño, sesión y magic bytes reales
  if (req.method === "POST") {
    try {
      const { filename, base64 } = req.body as {
        filename?: string;
        contentType?: string;
        base64?: string;
      };

      if (!filename || !base64) {
        return res.status(400).json({ error: "Faltan datos obligatorios (filename, base64)" });
      }

      const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(cleanBase64, "base64");

      if (buffer.length === 0) {
        return res.status(400).json({ error: "El archivo de imagen está vacío" });
      }

      const MAX_SIZE = 15 * 1024 * 1024; // 15MB
      if (buffer.length > MAX_SIZE) {
        return res.status(400).json({ error: "La imagen supera el límite de 15 MB" });
      }

      // Verificación estricta de Magic Bytes (firma binaria real)
      const magicCheck = isValidImageMagicBytes(buffer);
      if (!magicCheck.valid) {
        return res.status(400).json({
          error: "Formato de archivo inválido. El contenido no corresponde a una imagen PNG, JPG o WEBP real.",
        });
      }

      // Carpeta destino en public/uploads/social-posts
      const uploadDir = path.join(process.cwd(), "public", "uploads", "social-posts");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const ext = magicCheck.ext;
      const sanitizedBase = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40);
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
          // Ignorar si el directorio /data no tiene permisos
        }
      }

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
