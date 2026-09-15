import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: "La extensión local fue retirada; el estado se obtiene de Unipile.", code: "extension_retired" });
}
