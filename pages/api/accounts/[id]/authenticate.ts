import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({
    error: "La autenticación por cookies fue retirada. Conecta la cuenta mediante Hosted Auth de Unipile.",
    code: "cookie_auth_retired",
  });
}
