import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: "La sincronización local fue retirada; usa el inbox de Unipile.", code: "extension_retired" });
}
