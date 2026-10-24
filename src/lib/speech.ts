import { FormData } from "undici";

// Match FormData to the HTTP client. Native Node FormData can be serialized
// incorrectly by a separately installed undici, losing multipart fields.
export function transcriptionBody(
  bytes: Uint8Array,
  mime: string,
  filename: string,
  model: string,
  language?: string,
) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    filename,
  );
  form.append("model", model);
  if (language) form.append("language", language);
  return form;
}
