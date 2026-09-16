import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: "El ejecutor local de LinkedIn fue retirado. Las campañas y el inbox usan el motor cloud de InHubFlow.",
    code: "extension_retired",
  });
}
