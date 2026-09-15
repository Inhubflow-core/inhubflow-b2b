import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: "El ejecutor local de LinkedIn fue retirado. Las campañas e inbox usan Unipile.",
    code: "extension_retired",
  });
}
