/** Node 24 server-side client. Keep bearer credentials out of browser bundles. */
import { environmentFetch } from "./transport";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  reconciliationStart,
  reconciliationCheck,
  reconciliationCheckpoint,
  reconciliationRef,
} from "../src/lib/integration-reconciliation";
import type {
  studyDto,
  responseDto,
  analysisDto,
} from "../src/lib/external-api";
export type SourceRef = z.infer<typeof reconciliationRef>;
export type SourceData =
  | ReturnType<typeof studyDto>
  | ReturnType<typeof responseDto>
  | ReturnType<typeof analysisDto>;
export const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const opaque = z.string().regex(/^[a-f0-9]{64}$/);
const state = z.enum(["active", "complete", "needs_rescan"]);
export const runSchema = z
  .object({
    id: opaque,
    version: z.number().int().positive(),
    position: z.number().int().nonnegative(),
    total: z.number().int().min(0).max(1000),
    pageSize: z.number().int().min(1).max(100),
    state,
    scopeFingerprint: opaque,
  })
  .passthrough();
const itemSchema = reconciliationRef
  .extend({
    state: z.enum(["available", "changed", "unavailable"]),
    etag: opaque.nullable(),
  })
  .passthrough();
export const viewSchema = z.object({
  run: runSchema,
  page: z
    .object({
      position: z.number().int().nonnegative(),
      items: z.array(itemSchema).max(100),
      pageToken: opaque,
      hasMore: z.boolean(),
      rescanRequired: z.boolean(),
    })
    .nullable(),
  rescanRequired: z.boolean(),
});
export class EchoLabError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfterMs = 0,
  ) {
    super(`Echo Lab request failed (${status}, ${code}).`);
    this.name = "EchoLabError";
  }
}
export class SourceChanged extends Error {
  constructor() {
    super("The source changed; re-read the inventory page.");
  }
}
export class EchoLabClient {
  readonly origin: string;
  private token: string;
  private fetcher: typeof fetch;
  private attempts: number;
  private wait: (ms: number) => Promise<void>;
  constructor(options: {
    origin: string;
    token: string;
    allowLoopback?: boolean;
    fetch?: typeof fetch;
    attempts?: number;
    wait?: (ms: number) => Promise<void>;
  }) {
    const u = new URL(options.origin);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      !(
        u.protocol === "https:" ||
        (options.allowLoopback &&
          u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname))
      )
    )
      throw Error(
        "Use an HTTPS origin, or explicitly enable a loopback development origin.",
      );
    if (!/^elk_[a-f0-9]{64}$/.test(options.token))
      throw Error("A static API key is required.");
    this.origin = u.origin;
    this.token = options.token;
    this.fetcher =
      options.fetch || (u.protocol === "http:" ? fetch : environmentFetch);
    this.attempts = options.attempts ?? 3;
    if (
      !Number.isInteger(this.attempts) ||
      this.attempts < 1 ||
      this.attempts > 5
    )
      throw Error("Use 1–5 attempts.");
    this.wait = options.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  binding(selection: unknown) {
    return fingerprint([this.origin, fingerprint(this.token), selection]);
  }
  private async request(
    path: string,
    method = "GET",
    data?: unknown,
  ): Promise<unknown> {
    // Paths are constructed here, never taken from API responses or notifications.
    const bytes = data === undefined ? undefined : JSON.stringify(data);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(this.origin + "/api/v1/" + path, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: {
            authorization: "Bearer " + this.token,
            accept: "application/json",
            ...(bytes ? { "content-type": "application/json" } : {}),
          },
          body: bytes,
        });
      } catch {
        if (attempt + 1 >= this.attempts)
          throw new EchoLabError(0, "network_outcome_unknown");
        await this.wait(250 * 2 ** attempt);
        continue;
      }
      const retry = response.headers.get("retry-after");
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 250 * 2 ** attempt;
      const backoff = Number.isFinite(delay) ? Math.max(0, delay) : 1000;
      if (
        [408, 429, 500, 502, 503, 504].includes(response.status) &&
        attempt + 1 < this.attempts &&
        backoff <= 60000
      ) {
        await response.body?.cancel();
        await this.wait(backoff);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new EchoLabError(response.status, "request_failed", backoff);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new EchoLabError(502, "invalid_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const p = await reader.read();
          if (p.done) break;
          size += p.value.byteLength;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new EchoLabError(502, "response_too_large");
          }
          chunks.push(p.value);
        }
      } catch (e) {
        if (e instanceof EchoLabError) throw e;
        throw new EchoLabError(0, "response_outcome_unknown");
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new EchoLabError(502, "invalid_json");
      }
    }
  }
  async start(input: z.input<typeof reconciliationStart>) {
    const body = reconciliationStart.parse(input);
    return z
      .object({ run: runSchema })
      .parse(await this.request("reconciliation/runs", "POST", body)).run;
  }
  async view(id: string) {
    return viewSchema.parse(
      await this.request("reconciliation/runs/" + opaque.parse(id)),
    );
  }
  async checkpoint(
    id: string,
    input: z.input<typeof reconciliationCheckpoint>,
  ) {
    const body = reconciliationCheckpoint.parse(input);
    return z
      .object({
        checkpoint: z.object({
          requestId: z.uuid(),
          version: z.number().int().positive(),
          position: z.number().int().nonnegative(),
          state,
        }),
        reused: z.boolean(),
      })
      .parse(
        await this.request(
          "reconciliation/runs/" + opaque.parse(id) + "/checkpoint",
          "POST",
          body,
        ),
      );
  }
  async check(items: SourceRef[]) {
    const body = reconciliationCheck.parse({ items });
    const result = z
      .object({
        items: z
          .array(
            reconciliationRef.extend({
              state: z.enum(["available", "unavailable"]),
              etag: opaque.nullable(),
            }),
          )
          .max(100),
      })
      .parse(await this.request("reconciliation/check", "POST", body));
    if (
      result.items.length !== items.length ||
      result.items.some(
        (r, i) =>
          r.id !== items[i].id ||
          r.studyId !== items[i].studyId ||
          r.resource !== items[i].resource,
      )
    )
      throw new EchoLabError(502, "reference_mismatch");
    return result.items;
  }
  async source(ref: SourceRef, etag: string): Promise<SourceData> {
    reconciliationRef.parse(ref);
    opaque.parse(etag);
    const path =
      "studies/" +
      ref.studyId +
      (ref.resource === "study"
        ? ""
        : "/" +
          (ref.resource === "response" ? "responses" : "analyses") +
          "/" +
          ref.id);
    const r = z
      .object({
        data: z
          .object({ id: z.uuid(), studyId: z.uuid().optional() })
          .passthrough(),
      })
      .parse(await this.request(path));
    if (
      r.data.id !== ref.id ||
      (ref.resource !== "study" && r.data.studyId !== ref.studyId) ||
      fingerprint(r.data) !== etag
    )
      throw new SourceChanged();
    return r.data as SourceData;
  }
}
