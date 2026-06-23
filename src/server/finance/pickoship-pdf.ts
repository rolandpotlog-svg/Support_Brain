// PDF -> Text (server-only) via pdf-parse v2. createRequire, da pdf-parse CJS ist
// und in next.config als serverExternalPackages geführt wird.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = require("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text as string;
}
