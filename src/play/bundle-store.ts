import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_TOTAL_BYTES = 1_000_000_000;
const MAX_CHUNK_BYTES = 500_000;
const MAX_BROWSER_CHUNK_BYTES = 8 * 1024 * 1024;
const EXPIRES_MS = 6 * 60 * 60 * 1000;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
type UploadPhase = "receiving" | "saving" | "completed";
type LockOwner = { pid: number; token: string };

export interface UploadMetadata {
  id: string;
  userId: string;
  accountId: string;
  directory: string;
  filename: string;
  totalBytes: number;
  receivedBytes: number;
  sha256?: string;
  createdAt: number;
  phase?: UploadPhase;
  result?: unknown;
  error?: string;
}

export class PlayBundleStore {
  constructor(private readonly userId: string, private readonly root = process.env.PUBLIC_BASE_URL ? join(process.cwd(), ".private-play-bundles") : join(tmpdir(), "parmtech-play-bundles-v1")) {}

  private path(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error("Invalid upload ID.");
    return join(this.root, id);
  }

  private async metadata(id: string): Promise<UploadMetadata> {
    let meta: UploadMetadata;
    try { meta = JSON.parse(await readFile(join(this.path(id), "meta.json"), "utf8")); }
    catch { throw new Error("Upload not found or expired."); }
    if (meta.id !== id || meta.userId !== this.userId || Date.now() - meta.createdAt > EXPIRES_MS) throw new Error("Upload not found or expired.");
    return meta;
  }

  private async locked<T>(id: string, action: (meta: UploadMetadata, directory: string) => Promise<T>): Promise<T> {
    const directory = this.path(id);
    await this.metadata(id);
    return this.withLock(join(directory, "lock"), async () => action(await this.metadata(id), directory));
  }

  private async lockIsAbandoned(lock: string, originalMtime?: number): Promise<boolean> {
    let owner: LockOwner;
    try { owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8")); }
    catch {
      try { return Date.now() - (originalMtime ?? (await stat(lock)).mtimeMs) > 60_000; }
      catch { return true; }
    }
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return true;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  }

  private async withLock<T>(lock: string, action: () => Promise<T>): Promise<T> {
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Serialize recovery inside the old lock, so two callers cannot delete
      // a newly acquired lock after observing the same dead owner.
      const originalMtime = (await stat(lock)).mtimeMs;
      if (!(await this.lockIsAbandoned(lock, originalMtime))) throw new Error("This upload is already being updated.");
      const recovery = join(lock, "recovery");
      try { await mkdir(recovery); } catch { throw new Error("This upload is already being updated."); }
      if (!(await this.lockIsAbandoned(lock, originalMtime))) {
        await rm(recovery, { recursive: true, force: true });
        throw new Error("This upload is already being updated.");
      }
      await rm(lock, { recursive: true, force: true });
      try { await mkdir(lock); } catch { throw new Error("This upload is already being updated."); }
    }
    const owner: LockOwner = { pid: process.pid, token: randomUUID() };
    try {
      await writeFile(join(lock, "owner.json"), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
      return await action();
    } finally {
      try {
        const current: LockOwner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
        if (current.token === owner.token) await rm(lock, { recursive: true, force: true });
      } catch { /* an incomplete lock can be reclaimed after its grace period */ }
    }
  }

  private async save(directory: string, meta: UploadMetadata): Promise<void> {
    const temp = join(directory, `meta-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(meta), { mode: 0o600, flag: "wx" });
    await rename(temp, join(directory, "meta.json"));
  }

  async begin(input: { accountId: string; directory: string; filename: string; totalBytes: number; sha256?: string }): Promise<{ uploadId: string; maxChunkBytes: number; maxBrowserChunkBytes: number; expiresInMinutes: number }> {
    if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 1 || input.totalBytes > MAX_TOTAL_BYTES) throw new Error("File must be between 1 byte and 1 GB.");
    if (!input.directory || /[\r\n\0]/.test(input.directory) || input.directory.length > 1024) throw new Error("Invalid destination directory.");
    if (!input.filename || input.filename === "." || input.filename === ".." || /[\\/\r\n\0\";]/.test(input.filename) || input.filename.length > 255) throw new Error("Invalid destination filename.");
    if (input.sha256 && !/^[0-9a-f]{64}$/i.test(input.sha256)) throw new Error("SHA-256 must have 64 hexadecimal characters.");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(this.root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (process.getuid && (rootInfo.uid !== process.getuid() || (rootInfo.mode & 0o077) !== 0))) throw new Error("Private upload staging is not secure.");
    const userLock = join(this.root, `user-${createHash("sha256").update(this.userId).digest("hex")}.lock`);
    return this.withLock(userLock, async () => {
    const entries = await readdir(this.root, { withFileTypes: true });
    let active = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      const directory = this.path(entry.name);
      const age = Date.now() - (await stat(directory)).mtimeMs;
      if (age > EXPIRES_MS && !(await readdir(directory)).includes("lock")) { await rm(directory, { recursive: true, force: true }); continue; }
      try { if ((await this.metadata(entry.name)).phase !== "completed") active++; } catch { /* another account or expired upload */ }
    }
    if (active >= 1) throw new Error("Finish or cancel the existing staged upload first.");
    const id = randomUUID();
    const directory = this.path(id);
    await mkdir(directory, { mode: 0o700 });
    const meta: UploadMetadata = { id, userId: this.userId, accountId: input.accountId, directory: input.directory, filename: input.filename, totalBytes: input.totalBytes, receivedBytes: 0, createdAt: Date.now(), phase: "receiving", ...(input.sha256 ? { sha256: input.sha256.toLowerCase() } : {}) };
    await writeFile(join(directory, "data.bin"), Buffer.alloc(0), { mode: 0o600, flag: "wx" });
    await writeFile(join(directory, "meta.json"), JSON.stringify(meta), { mode: 0o600, flag: "wx" });
    return { uploadId: id, maxChunkBytes: MAX_CHUNK_BYTES, maxBrowserChunkBytes: MAX_BROWSER_CHUNK_BYTES, expiresInMinutes: 360 };
    });
  }

  async append(id: string, offset: number, contentBase64: string): Promise<{ receivedBytes: number; remainingBytes: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !BASE64_PATTERN.test(contentBase64) || contentBase64.length > Math.ceil(MAX_CHUNK_BYTES / 3) * 4 + 4) throw new Error("Invalid chunk or offset.");
    const bytes = Buffer.from(contentBase64, "base64");
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES) throw new Error("Chunk must be between 1 byte and 500 KB.");
    return this.appendBytes(id, offset, bytes);
  }

  async appendBytes(id: string, offset: number, bytes: Uint8Array): Promise<{ receivedBytes: number; remainingBytes: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !bytes.length || bytes.length > MAX_BROWSER_CHUNK_BYTES) throw new Error("Chunk must be between 1 byte and 8 MB.");
    return this.locked(id, async (meta, directory) => {
      if (meta.phase === "completed") throw new Error("Upload is already completed.");
      if (offset !== meta.receivedBytes) throw new Error(`Next chunk must start at byte ${meta.receivedBytes}.`);
      if (offset + bytes.length > meta.totalBytes) throw new Error("Chunk exceeds the declared file size.");
      const file = join(directory, "data.bin");
      const length = (await stat(file)).size;
      if (length < meta.receivedBytes) throw new Error("Staged file length differs from upload progress. Cancel and restart.");
      const handle = await open(file, "r+");
      try {
        // A crash can leave an unacknowledged tail between data and metadata
        // writes. Only replay bytes after the last durable acknowledged offset.
        if (length > meta.receivedBytes) await handle.truncate(meta.receivedBytes);
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, meta.receivedBytes + written);
          if (!result.bytesWritten) throw new Error("Unable to write upload chunk.");
          written += result.bytesWritten;
        }
        await handle.sync();
      } finally { await handle.close(); }
      meta.receivedBytes += bytes.length;
      meta.phase = "receiving";
      delete meta.error;
      await this.save(directory, meta);
      return { receivedBytes: meta.receivedBytes, remainingBytes: meta.totalBytes - meta.receivedBytes };
    });
  }

  async status(id: string): Promise<{ accountId: string; directory: string; filename: string; totalBytes: number; receivedBytes: number; phase: UploadPhase; result?: unknown; needsRetry?: boolean; error?: string }> {
    const meta = await this.metadata(id);
    const needsRetry = meta.phase === "saving" && await this.lockIsAbandoned(join(this.path(id), "lock"));
    return { accountId: meta.accountId, directory: meta.directory, filename: meta.filename, totalBytes: meta.totalBytes, receivedBytes: meta.receivedBytes, phase: meta.phase ?? "receiving", ...(meta.phase === "completed" ? { result: meta.result } : {}), ...(needsRetry ? { needsRetry: true } : {}), ...(meta.error ? { error: meta.error } : {}) };
  }

  async finish<T>(id: string, upload: (meta: UploadMetadata, file: Blob, filePath: string) => Promise<T>): Promise<T> {
    return this.locked(id, async (meta, directory) => {
      if (meta.phase === "completed") return meta.result as T;
      const filePath = join(directory, "data.bin");
      let committed = false;
      try {
        meta.phase = "saving";
        delete meta.error;
        await this.save(directory, meta);
        if (meta.receivedBytes !== meta.totalBytes || (await stat(filePath)).size !== meta.totalBytes) throw new Error("Upload is incomplete.");
        if (meta.sha256) {
          const hash = createHash("sha256");
          const handle = await open(filePath, "r");
          try { for await (const part of handle.createReadStream()) hash.update(part); }
          finally { await handle.close(); }
          if (hash.digest("hex") !== meta.sha256) throw new Error("SHA-256 does not match the staged file.");
        }
        const file = await openAsBlob(filePath, { type: "application/octet-stream" });
        const result = await upload(meta, file, filePath);
        meta.phase = "completed";
        meta.result = result ?? null;
        await this.save(directory, meta);
        committed = true;
        // A cleanup problem cannot turn a confirmed transfer into a failure.
        // Expiry cleanup will reclaim the retained temporary copy later.
        await rm(filePath, { force: true }).catch(() => {});
        return result;
      } catch (error) {
        if (!committed) {
          meta.phase = "receiving";
          delete meta.result;
          meta.error = "File validation or saving failed. The staged file is retained for retry.";
          await this.save(directory, meta);
        }
        throw error;
      }
    }).finally(async () => {
      const directory = this.path(id);
      try { if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true }); } catch { /* retained for retry or already removed */ }
    });
  }

  async cancel(id: string): Promise<{ cancelled: true }> {
    await this.locked(id, async (_meta, directory) => {
      await rm(join(directory, "data.bin"), { force: true });
      await rm(join(directory, "meta.json"), { force: true });
    });
    await rm(this.path(id), { recursive: true, force: true });
    return { cancelled: true };
  }
}
