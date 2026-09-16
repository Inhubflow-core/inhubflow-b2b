import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: "La extensión local fue retirada; los resultados se procesan mediante el motor cloud de InHubFlow.", code: "extension_retired" });
}
