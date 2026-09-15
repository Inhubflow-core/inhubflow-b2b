import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: "La extensión local fue retirada; los resultados provienen de Unipile.", code: "extension_retired" });
}
