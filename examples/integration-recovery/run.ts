import { createServer } from "node:http";
import { Readable } from "node:stream";
import {
  EchoLabClient,
  EchoLabError,
} from "../../integrations/echo-lab-client";
import { FileDestination } from "./store";
import { syncDestination, selectionOf } from "./sync";
import { acceptNotification } from "./receiver";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["sync", "receive"].includes(command))
    throw Error(
      "Use sync or receive with --directory <private disposable path> [--initialize].",
    );
  const initialize = args.includes("--initialize"),
    restart = args.includes("--restart"),
    rest = args.filter((a) => a !== "--initialize" && a !== "--restart");
  if (rest.length !== 2 || rest[0] !== "--directory")
    throw Error("Supply --directory <private disposable path> [--initialize].");
  const origin = process.env.ECHO_LAB_URL || "",
    token = process.env.ECHO_LAB_API_KEY || "";
  const selection = selectionOf({
    studyIds: (process.env.ECHO_LAB_STUDY_IDS || "").split(",").filter(Boolean),
    resources: (
      process.env.ECHO_LAB_RESOURCES || "study,response,analysis"
    ).split(",") as ("study" | "response" | "analysis")[],
    pageSize: 50,
  });
  const client = new EchoLabClient({ origin, token, allowLoopback: true }),
    store = await FileDestination.connect(
      rest[1],
      client.binding(selection),
      initialize,
    );
  if (restart && command !== "sync")
    throw Error("Use --restart only with sync.");
  if (command === "sync") {
    if (restart)
      await store.exclusive(async () => {
        const saved = await store.load();
        delete saved.runId;
        delete saved.start;
        delete saved.pending;
        await store.save(saved);
      });
    const result = await store.exclusive(() =>
      syncDestination(client, store, selection),
    );
    console.log(JSON.stringify(result));
    if (result.state !== "complete")
      console.log("Run sync again to resume or start the required fresh scan.");
    return;
  }
  const secret = process.env.ECHO_LAB_SIGNING_KEY || "";
  if (!/^eln_[a-f0-9]{64}$/.test(secret))
    throw Error(
      "Set ECHO_LAB_SIGNING_KEY privately before starting a receiver.",
    );
  const port = Number(process.env.ECHO_LAB_RECEIVER_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Use an unprivileged receiver port.");
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/notifications") {
      res.writeHead(404).end();
      return;
    }
    if (Number(req.headers["content-length"] || 0) > 65536) {
      req.resume();
      res.writeHead(413).end();
      return;
    }
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(",") : v);
      const request = new Request("http://127.0.0.1:8787/notifications", {
        method: "POST",
        headers,
        body: Readable.toWeb(req),
        duplex: "half",
      } as RequestInit);
      const result = await store.exclusive(() =>
        acceptNotification(request, secret, selection.studyIds, store),
      );
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      req.resume();
      if (!res.headersSent && !res.destroyed)
        res.writeHead(503, { "retry-after": "5" }).end();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Receiver listening at http://127.0.0.1:${port}/notifications. Accepted wake-ups are durable; run sync periodically and after notifications. Public delivery requires an explicitly approved HTTPS gateway.`,
    ),
  );
}
main().catch((error) => {
  if (error instanceof EchoLabError)
    console.error(
      `API status ${error.status}; ${error.code}; retry delay ${error.retryAfterMs} ms. Resume with the same private destination.`,
    );
  console.error(
    "Integration command stopped. Check configuration, permissions, destination lock and API availability. No credential or research content is logged. See docs/integration-client.md.",
  );
  process.exitCode = 1;
});
