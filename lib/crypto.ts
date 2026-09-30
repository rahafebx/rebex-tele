import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Secrets at rest (Telegram bot tokens, the webhook secret) are encrypted
// with AES-256-GCM before being written to the DB, keyed by the server-only
// TELEX_ENCRYPTION_KEY env var (any string; a 256-bit key is derived from it
// via SHA-256).
//
// Stored format: `enc:v1:<iv hex>:<tag hex>:<ciphertext hex>`.
// Values without that prefix (legacy plaintext rows written before this
// feature shipped) are returned untouched, so enabling encryption needs no
// migration and no data rewrite — old rows keep working and become encrypted
// the next time the admin re-saves the token in Settings/Commands.
const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const KEY_MISSING =
  "لم يتم ضبط مفتاح التشفير (TELEX_ENCRYPTION_KEY) على الخادم. أضفه إلى متغيرات البيئة ثم أعد حفظ الرمز.";

function encryptionKey(): Buffer {
  const raw = process.env.TELEX_ENCRYPTION_KEY;
  if (!raw) throw new Error(KEY_MISSING);
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null || !value.startsWith(PREFIX)) return value; // legacy plaintext
  const rest = value.slice(PREFIX.length);
  const sep1 = rest.indexOf(":");
  const sep2 = rest.indexOf(":", sep1 + 1);
  if (sep1 < 0 || sep2 < 0)
    throw new Error("قيمة مشفّرة غير صالحة في قاعدة البيانات.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(rest.slice(0, sep1), "hex"),
  );
  decipher.setAuthTag(Buffer.from(rest.slice(sep1 + 1, sep2), "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(rest.slice(sep2 + 1), "hex")),
    decipher.final(),
  ]).toString("utf8");
}

// Decrypt a secret that is known to be present (callers guard against
// missing tokens first). Throws if the key is unset or the value is corrupt
// (bad MAC), so auth failures are loud rather than sending garbage tokens.
export function decryptToken(value: string | null | undefined): string {
  const decrypted = decryptSecret(value);
  if (!decrypted) throw new Error("رمز بوت مفقود في قاعدة البيانات.");
  return decrypted;
}