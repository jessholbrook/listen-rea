import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dataDir } from "./db";
function key() {
  const env = process.env.RESEARCH_NOTIFICATION_ENCRYPTION_KEY;
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length !== 32)
      throw new Error("NOTIFICATION_ENCRYPTION_CONFIGURATION");
    return k;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    throw new Error("NOTIFICATION_ENCRYPTION_CONFIGURATION");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const p = path.join(dataDir, "notification-signing.key");
  if (!existsSync(p)) {
    try {
      writeFileSync(p, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  return readFileSync(p);
}
export function notificationEncryptionReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function sealNotificationKey(value: unknown, id: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString("base64"))
    .join(".");
}
export function openNotificationKey<T>(sealed: string, id: string): T {
  const [iv, tag, data] = sealed
    .split(".")
    .map((v) => Buffer.from(v, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  );
}
