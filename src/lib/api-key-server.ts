import { z } from "zod";
import { actor, body, respond, fail } from "./http";
import { get, put, list, hash, now, transaction } from "./db";
import type { Study } from "./domain";
import { apiKeyView, keyInput, type ReadApiKey } from "./external-api";
export async function dispatchApiKeys(req: Request, p: string[]) {
  if (p[0] !== "api-keys") return null;
  const a = await actor();
  if (a.role !== "admin")
    fail(403, "Only workspace admins can manage API keys.");
  if (req.method === "GET" && p.length === 1)
    return respond({
      keys: (await list<ReadApiKey>("readApiKey", a.workspaceId)).map(
        apiKeyView,
      ),
      studies: (await list<Study>("study", a.workspaceId)).map((s) => ({
        id: s.id,
        title: s.title,
        published: !!s.revisionId,
      })),
    });
  if (req.method === "POST" && p.length === 1) {
    const input = keyInput.parse(await body(req)),
      raw = "elk_" + input.secret,
      id = hash(raw),
      receiptId = a.workspaceId + ":" + input.requestId,
      fingerprint = hash(JSON.stringify(input));
    await transaction(async () => {
      const receipt = await get<{ fingerprint: string; keyId: string }>(
        "apiKeyRequest",
        receiptId,
        a.workspaceId,
      );
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail(409, "This request ID was already used for a different key.");
        return;
      }
      if (
        Date.parse(input.expiresAt) <= Date.now() ||
        Date.parse(input.expiresAt) > Date.now() + 90 * 86400000
      )
        fail(400, "Key expiry must be in the future and within 90 days.");
      const all = await list<ReadApiKey>("readApiKey", a.workspaceId);
      if (all.length >= 100)
        fail(409, "This workspace has reached its 100-key record limit.");
      if (
        all.filter((k) => !k.revokedAt && Date.parse(k.expiresAt) > Date.now())
          .length >= 20
      )
        fail(
          409,
          "Revoke an unused key before creating more than 20 active keys.",
        );
      for (const studyId of input.studyIds) {
        const s = await get<Study>("study", studyId, a.workspaceId);
        if (!s) fail(404, "One of the selected studies was not found.");
      }
      if (await get("readApiKey", id))
        fail(409, "This key secret was already used. Generate a new key.");
      await put("readApiKey", {
        id,
        workspaceId: a.workspaceId,
        ownerId: a.id,
        name: input.name,
        studyIds: input.studyIds,
        scopes: input.scopes,
        createdAt: now(),
        expiresAt: input.expiresAt,
        version: 1,
      } satisfies ReadApiKey);
      await put("apiKeyRequest", {
        id: receiptId,
        workspaceId: a.workspaceId,
        keyId: id,
        fingerprint,
      });
    });
    const k = (await get<ReadApiKey>("readApiKey", id, a.workspaceId))!;
    return respond({ key: apiKeyView(k), token: raw }, 201);
  }
  if (req.method === "POST" && p.length === 3 && p[2] === "revoke") {
    const input = z
      .object({ version: z.number().int().min(1) })
      .parse(await body(req));
    await transaction(async () => {
      const k = await get<ReadApiKey>("readApiKey", p[1], a.workspaceId);
      if (!k) fail(404, "API key not found.");
      if (k.revokedAt) return;
      if (k.version !== input.version)
        fail(409, "This key changed. Refresh before revoking.");
      await put("readApiKey", {
        ...k,
        revokedAt: now(),
        version: k.version + 1,
      });
    });
    return respond({ ok: true });
  }
  fail(405, "Unsupported API-key management action.");
}
