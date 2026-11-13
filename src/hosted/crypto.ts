import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, keyLength, options, (error, key) => error ? reject(error) : resolve(key as Buffer)));
}

function encryptionKey(): Buffer {
  const encoded = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Hosted credential encryption is not configured.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Hosted credential encryption key must be valid base64.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("Hosted credential encryption key must decode to exactly 32 bytes.");
  return key;
}

export function assertEncryptionConfigured(): void { void encryptionKey(); }

export function encryptSecret(plaintext: string, context: string, key = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, context: string, key = encryptionKey()): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = envelope.split(".");
  if (version !== "v2" || !ivPart || !tagPart || !ciphertextPart || extra) throw new Error("Stored credential is not a supported encrypted envelope.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}

export function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createId(): string {
  return randomUUID();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [kind, n, r, p, saltPart, keyPart, extra] = encoded.split("$");
  if (kind !== "scrypt" || n !== "32768" || r !== "8" || p !== "1" || !saltPart || !keyPart || extra) return false;
  const salt = Buffer.from(saltPart, "base64url");
  const expected = Buffer.from(keyPart, "base64url");
  const actual = await scrypt(password, salt, expected.length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
