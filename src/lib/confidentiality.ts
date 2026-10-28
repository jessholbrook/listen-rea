import { createHash } from "node:crypto";
import type { Guide } from "./domain";
import type { Language } from "./localization";
export function confidentialityNotice(
  guide: Guide,
  revisionId: string,
  language: Language,
) {
  if (!guide.confidentiality) return null;
  const { title, text } = guide.confidentiality;
  const version = createHash("sha256")
    .update(JSON.stringify([revisionId, language, title, text]))
    .digest("hex");
  return { title, text, version, language, revisionId };
}
