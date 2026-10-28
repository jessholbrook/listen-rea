export async function api<T = any>(
  path: string,
  method = "GET",
  data?: unknown,
  headers?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method,
    signal,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(data instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...headers,
    },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || "Request failed.");
  return out;
}
