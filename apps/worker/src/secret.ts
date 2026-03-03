import { createDecipheriv, createHash } from "node:crypto";
import { getEnv } from "./env";

function deriveKey(): Buffer {
  const { APP_MASTER_KEY } = getEnv();
  return createHash("sha256").update(APP_MASTER_KEY).digest();
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted payload");

  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);

  return plain.toString("utf8");
}
