import { fetch, EnvHttpProxyAgent } from "undici";
const dispatcher = new EnvHttpProxyAgent();
// Hrana constructs native Request objects. Translate their body explicitly to
// avoid crossing incompatible native/installed-undici request brands.
export async function databaseFetch(
  input: Request | string | URL,
  init?: RequestInit,
) {
  if (typeof input === "object" && "url" in input && "arrayBuffer" in input) {
    const body = ["GET", "HEAD"].includes(input.method)
      ? undefined
      : new Uint8Array(await input.arrayBuffer());
    return fetch(input.url, {
      method: input.method,
      headers: Object.fromEntries(input.headers.entries()),
      body,
      signal: input.signal,
      dispatcher,
    });
  }
  return fetch(input as string | URL, {
    ...init,
    body: init?.body as never,
    dispatcher,
  });
}
