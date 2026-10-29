import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";
const dispatcher = new EnvHttpProxyAgent();
/** Preserve the host's proxy/NO_PROXY and CA policy for HTTPS API requests. */
export const environmentFetch: typeof fetch = async (input, init) =>
  proxyFetch(
    typeof input === "object" && "url" in input
      ? input.url
      : (input as string | URL),
    { ...init, body: init?.body as never, dispatcher },
  ) as unknown as Response;
