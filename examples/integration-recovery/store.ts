import {
  open,
  mkdir,
  lstat,
  readFile,
  rename,
  unlink,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  reconciliationRef,
  reconciliationStart,
  reconciliationCheckpoint,
} from "../../src/lib/integration-reconciliation";
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const snapshotSchema = z
  .object({
    format: z.literal(1),
    binding: hex,
    copies: z
      .array(z.object({ ref: reconciliationRef, etag: hex, data: z.unknown() }))
      .max(1000),
    start: reconciliationStart.optional(),
    runId: hex.optional(),
    pending: reconciliationCheckpoint.optional(),
    receipts: z
      .array(z.object({ idHash: hex, bodyHash: hex, at: z.number() }))
      .max(1000),
    wake: z.number().int().nonnegative(),
    syncedWake: z.number().int().nonnegative(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export const emptySnapshot = (binding: string): Snapshot => ({
  format: 1,
  binding,
  copies: [],
  receipts: [],
  wake: 0,
  syncedWake: 0,
});
export interface Destination {
  load(): Promise<Snapshot>;
  save(value: Snapshot): Promise<void>;
}
/** A private, disposable, single-machine destination, not a production database. */
export class FileDestination implements Destination {
  private constructor(
    readonly directory: string,
    private binding: string,
  ) {}
  static async connect(directory: string, binding: string, initialize = false) {
    const resolved = path.resolve(directory);
    // Only a newly created directory may be initialized. Never adopt somebody else's data.
    if (initialize) {
      await mkdir(resolved, { mode: 0o700 });
      await chmod(resolved, 0o700);
    }
    const st = await lstat(resolved);
    if (!st.isDirectory() || st.isSymbolicLink() || st.mode & 0o077)
      throw Error(
        "Use a private destination directory (mode 0700), without symlinks.",
      );
    const store = new FileDestination(resolved, binding);
    if (initialize)
      await store.exclusive(async () => {
        await store.save(emptySnapshot(binding));
      });
    else await store.load();
    return store;
  }
  async load() {
    const filename = path.join(this.directory, "destination.json"),
      st = await lstat(filename);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.mode & 0o077 ||
      st.size > 64 * 1024 * 1024
    )
      throw Error("Invalid private destination file.");
    const v = snapshotSchema.parse(
      JSON.parse(await readFile(filename, "utf8")),
    );
    if (v.binding !== this.binding)
      throw Error(
        "Destination belongs to a different origin, key or selection. Use a new disposable directory.",
      );
    return v;
  }
  async save(value: Snapshot) {
    snapshotSchema.parse(value);
    if (value.binding !== this.binding)
      throw Error("Destination binding changed.");
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > 64 * 1024 * 1024)
      throw Error("Disposable destination exceeds 64 MiB.");
    const temp = path.join(this.directory, randomUUID() + ".tmp"),
      target = path.join(this.directory, "destination.json");
    const f = await open(temp, "wx", 0o600);
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    try {
      await rename(temp, target);
      const dir = await open(this.directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  async exclusive<T>(work: () => Promise<T>) {
    let lock;
    try {
      lock = await open(path.join(this.directory, "writer.lock"), "wx", 0o600);
    } catch {
      throw Error(
        "Destination is locked. Stop other writers; remove a stale writer.lock only after confirming its process has stopped.",
      );
    }
    try {
      return await work();
    } finally {
      await lock.close();
      await unlink(path.join(this.directory, "writer.lock"));
    }
  }
}
