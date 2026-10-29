import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  EchoLabClient,
  EchoLabError,
  SourceChanged,
  type SourceRef,
} from "../../integrations/echo-lab-client";
import {
  reconciliationStart,
  reconciliationIdentity,
} from "../../src/lib/integration-reconciliation";
import type { Destination, Snapshot } from "./store";
export type Selection = Omit<z.input<typeof reconciliationStart>, "requestId">;
export const selectionOf = (input: Selection) => {
  const { requestId, ...value } = reconciliationStart.parse({
    ...input,
    requestId: randomUUID(),
  });
  return {
    ...value,
    studyIds: [...value.studyIds].sort(),
    resources: [...value.resources].sort(),
  };
};
const included = (ref: SourceRef, s: ReturnType<typeof selectionOf>) =>
  s.studyIds.includes(ref.studyId) && s.resources.includes(ref.resource);
async function copy(
  client: EchoLabClient,
  ref: SourceRef,
  etag: string,
  s: Snapshot,
) {
  const old = s.copies.find(
    (c) => reconciliationIdentity(c.ref) === reconciliationIdentity(ref),
  );
  if (old?.etag === etag) return;
  const data = await client.source(ref, etag);
  s.copies = s.copies.filter(
    (c) => reconciliationIdentity(c.ref) !== reconciliationIdentity(ref),
  );
  s.copies.push({ ref, etag, data });
  if (s.copies.length > 1000)
    throw Error("Disposable destination holds at most 1,000 copies.");
}
/** Caller must serialize the entire operation with its destination's writer lock. */
export async function syncDestination(
  client: EchoLabClient,
  destination: Destination,
  input: Selection,
  maxPages = 20,
) {
  const selection = selectionOf(input),
    s = await destination.load();
  if (
    s.binding !== client.binding(selection) ||
    s.copies.some((c) => !included(c.ref, selection))
  )
    throw Error("Destination selection mismatch.");
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000)
    throw Error("Use 1–1,000 pages per invocation.");
  const wakeAtStart = s.wake;
  // A current inventory cannot identify all historical removals. Check the copies we actually hold.
  const held = s.copies.map((c) => c.ref);
  for (let offset = 0; offset < held.length; offset += 100) {
    const checked = await client.check(held.slice(offset, offset + 100));
    for (const item of checked) {
      const { resource, studyId, id } = item,
        ref = { resource, studyId, id };
      if (item.state === "unavailable") {
        if (item.etag !== null) throw Error("Invalid unavailable source.");
        s.copies = s.copies.filter(
          (c) => reconciliationIdentity(c.ref) !== reconciliationIdentity(ref),
        );
      } else {
        if (!item.etag) throw Error("Available source has no fingerprint.");
        await copy(client, ref, item.etag, s);
      }
    }
    await destination.save(s);
  }
  const reset = async (
    status: "needs_restart" | "needs_rescan" | "complete",
  ) => {
    delete s.runId;
    delete s.start;
    delete s.pending;
    if (status === "complete") s.syncedWake = wakeAtStart;
    await destination.save(s);
    return { state: status, copies: s.copies.length };
  };
  if (
    s.start &&
    JSON.stringify(selectionOf(s.start)) !== JSON.stringify(selection)
  )
    throw Error("Saved inventory selection mismatch.");
  if (!s.runId) {
    if (!s.start) {
      s.start = { ...selection, requestId: randomUUID() };
      await destination.save(s);
    }
    try {
      const run = await client.start(s.start);
      s.runId = run.id;
      await destination.save(s);
    } catch (e) {
      if (e instanceof EchoLabError && e.status === 410)
        return reset("needs_restart");
      throw e;
    }
  }
  try {
    for (let n = 0; n < maxPages; n++) {
      if (s.pending) {
        try {
          const result = await client.checkpoint(s.runId!, s.pending);
          if (
            result.checkpoint.requestId !== s.pending.requestId ||
            result.checkpoint.version !== s.pending.version + 1
          )
            throw Error("Unexpected checkpoint receipt.");
          delete s.pending;
          await destination.save(s);
          if (result.checkpoint.state !== "active")
            return reset(result.checkpoint.state);
        } catch (e) {
          if (e instanceof EchoLabError && e.status === 409) {
            delete s.pending;
            await destination.save(s);
          } else throw e;
        }
      }
      const view = await client.view(s.runId!);
      if (view.run.state !== "active") return reset(view.run.state);
      if (
        !view.page ||
        view.page.position !== view.run.position ||
        view.page.items.some((i) => !included(i, selection))
      )
        throw Error("Invalid inventory page.");
      for (const item of view.page.items) {
        const { resource, studyId, id } = item,
          ref = { resource, studyId, id };
        if (item.state === "unavailable") {
          if (item.etag !== null) throw Error("Invalid unavailable source.");
          s.copies = s.copies.filter(
            (c) =>
              reconciliationIdentity(c.ref) !== reconciliationIdentity(ref),
          );
        } else {
          if (!item.etag) throw Error("Available source has no fingerprint.");
          await copy(client, ref, item.etag, s);
        }
      }
      s.pending = {
        requestId: randomUUID(),
        version: view.run.version,
        position: view.page.position,
        pageToken: view.page.pageToken,
      };
      // Copy changes and the exact acknowledgment intent are one durable write BEFORE the network acknowledgment.
      await destination.save(s);
    }
    return { state: "paused" as const, copies: s.copies.length };
  } catch (e) {
    if (e instanceof EchoLabError && e.status === 410)
      return reset("needs_restart");
    if (
      e instanceof SourceChanged ||
      (e instanceof EchoLabError && e.status === 404)
    )
      return { state: "source_changed" as const, copies: s.copies.length };
    throw e;
  }
}
