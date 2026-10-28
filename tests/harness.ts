import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
export let base = "http://127.0.0.1:3101";
let child: ChildProcess;
let dir: string;
let buildDirectory: string | undefined;
let log = "";
export async function start(
  options: {
    live?: boolean;
    preview?: boolean;
    port?: number;
    restrict?: boolean;
    email?: boolean;
  } = {},
) {
  base = "http://127.0.0.1:" + (options.port || 3101);
  const production = process.env.RESEARCH_TEST_PRODUCTION === "1";
  buildDirectory = production
    ? undefined
    : path.join(
        process.cwd(),
        options.port ? ".next-test-" + options.port : ".next-test",
      );
  dir = mkdtempSync(path.join(tmpdir(), "fieldnotes-test-"));
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(options.port || 3101),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RESEARCH_DATA_DIR: dir,
        RESEARCH_BUILD_DIR: production
          ? ".next"
          : options.port
            ? ".next-test-" + options.port
            : ".next-test",
        RESEARCH_SETUP_CODE: options.restrict
          ? "test-only-internal-setup-code"
          : "",
        RESEARCH_AI_KEY: options.live ? process.env.RESEARCH_AI_KEY : "",
        LIBSQL_URL: "",
        LIBSQL_AUTH_TOKEN: "",
        TURSO_DATABASE_URL: "",
        TURSO_AUTH_TOKEN: "",
        RESEARCH_STORAGE: "local",
        RESEARCH_BACKGROUND_DRIVER: "manual",
        CRON_SECRET: "",
        RESEND_API_KEY: "",
        RESEARCH_EMAIL_FROM: options.email ? "research@example.test" : "",
        RESEARCH_EMAIL_REPLY_TO: options.email ? "reply@example.test" : "",
        RESEARCH_PUBLIC_URL: options.email ? base : "",
        RESEARCH_EMAIL_ENCRYPTION_KEY: options.email
          ? Buffer.alloc(32, 7).toString("base64")
          : "",
        VERCEL: options.preview ? "1" : "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (b) => {
    log += b.toString();
  });
  child.stderr?.on("data", (b) => {
    log += b.toString();
  });
  for (let n = 0; n < 90; n++) {
    if (child.exitCode !== null) throw new Error(log);
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Test server did not start: " + log);
}
export async function stop() {
  child?.kill("SIGTERM");
  if (child && child.exitCode === null)
    await new Promise<void>((r) => {
      child.once("exit", () => r());
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 5000).unref();
    });
  if (dir) rmSync(dir, { recursive: true, force: true });
  // Each harness owns its dev build directory. Remove it only after its server stops.
  // Preserve the shared production build used by compiled-app checks.
  if (buildDirectory) rmSync(buildDirectory, { recursive: true, force: true });
}
export async function client() {
  let cookie = "";
  return async (
    route: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(base + "/api/" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (!r.headers.get("content-type")?.includes("application/json"))
      return { status: r.status, text: await r.text() };
    const out = await r.json();
    return { status: r.status, ...out };
  };
}

export function dataDirectory() {
  return dir;
}
