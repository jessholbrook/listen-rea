import { fetch, EnvHttpProxyAgent } from "undici";
const dispatcher = new EnvHttpProxyAgent();
export const providerTimeout = (route: string) =>
  route === "audio/speech"
    ? 30000
    : route === "audio/transcriptions"
      ? 45000
      : 60000;
export async function providerFetch(
  url: string,
  init: Parameters<typeof fetch>[1],
  options: { timeoutMs: number; signal?: AbortSignal },
  transport = fetch,
) {
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  const response = await transport(url, { ...init, dispatcher, signal });
  return response;
}
