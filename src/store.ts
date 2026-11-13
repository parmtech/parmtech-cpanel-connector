import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Entry } from "@napi-rs/keyring";
import { normalizeCpanelHost, validateCpanelUsername } from "./host.js";
import type { AccountCredentials, AccountMetadata, AccountStore } from "./types.js";
import { UapiClient } from "./uapi.js";

const SERVICE_NAME = "PARMTECH cPanel Connector";
const APP_DIR_NAME = "PARMTECH-cPanel-Connector";

function dataDirectory(): string {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, APP_DIR_NAME);
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, APP_DIR_NAME);
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  return path.join(homedir(), ".config", APP_DIR_NAME);
}

function indexPath(): string {
  return path.join(dataDirectory(), "accounts.json");
}

export class SystemAccountStore implements AccountStore {
  private async readIndex(): Promise<AccountMetadata[]> {
    try {
      const text = await readFile(indexPath(), "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Account index is invalid.");
      return parsed as AccountMetadata[];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw new Error("Could not read the local account list. Remove the damaged accounts.json file and reconnect your accounts.");
    }
  }

  private async writeIndex(records: AccountMetadata[]): Promise<void> {
    const dir = dataDirectory();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(indexPath(), `${JSON.stringify(records, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async list(): Promise<AccountMetadata[]> {
    return this.readIndex();
  }

  async get(id: string): Promise<{ metadata: AccountMetadata; credentials: AccountCredentials }> {
    const metadata = (await this.readIndex()).find((item) => item.id === id);
    if (!metadata) throw new Error(`No connected cPanel account has ID ${id}. Use cpanel_list_accounts to see available accounts.`);
    let secret: string | null;
    try {
      secret = new Entry(SERVICE_NAME, `account:${id}`).getPassword();
    } catch {
      throw new Error(`The saved token for ${metadata.label} is unavailable in the operating system credential store.`);
    }
    if (!secret) throw new Error(`The saved token for ${metadata.label} is missing. Disconnect and reconnect this account.`);
    let credentials: AccountCredentials;
    try {
      credentials = JSON.parse(secret) as AccountCredentials;
    } catch {
      throw new Error(`The saved credentials for ${metadata.label} are invalid. Disconnect and reconnect this account.`);
    }
    return { metadata, credentials };
  }

  async add(input: { label: string; host: string; username: string; apiToken: string; tokenName?: string }): Promise<AccountMetadata> {
    const label = input.label.trim();
    const host = normalizeCpanelHost(input.host);
    const username = validateCpanelUsername(input.username);
    const apiToken = input.apiToken.trim();
    if (label.length < 1 || label.length > 80) throw new Error("Account label must be between 1 and 80 characters.");
    if (apiToken.length < 12 || /\s/.test(apiToken)) throw new Error("The API token does not look valid. Copy it from cPanel’s Manage API Tokens page.");
    const tokenName = input.tokenName?.trim();

    const credentials: AccountCredentials = {
      host,
      username,
      apiToken,
      ...(tokenName ? { tokenName } : {}),
    };
    await new UapiClient().call(credentials, "DomainInfo", "list_domains");

    const existing = await this.readIndex();
    if (existing.some((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase())) {
      throw new Error("That account label is already in use. Choose a different label.");
    }
    const metadata: AccountMetadata = {
      id: randomUUID(),
      label,
      host,
      username,
      ...(tokenName ? { tokenName } : {}),
      createdAt: new Date().toISOString(),
    };

    const entry = new Entry(SERVICE_NAME, `account:${metadata.id}`);
    try {
      entry.setPassword(JSON.stringify(credentials));
      await this.writeIndex([...existing, metadata]);
    } catch {
      try { entry.deletePassword(); } catch { /* best effort cleanup */ }
      throw new Error("Could not save the cPanel token in the operating system credential store.");
    }
    return metadata;
  }

  async remove(id: string): Promise<AccountMetadata> {
    const records = await this.readIndex();
    const metadata = records.find((item) => item.id === id);
    if (!metadata) throw new Error(`No connected cPanel account has ID ${id}.`);
    try {
      new Entry(SERVICE_NAME, `account:${id}`).deletePassword();
    } catch {
      throw new Error("Could not remove the token from the operating system credential store; the account remains connected.");
    }
    await this.writeIndex(records.filter((item) => item.id !== id));
    return metadata;
  }
}

export class MemoryAccountStore implements AccountStore {
  private readonly entries = new Map<string, { metadata: AccountMetadata; credentials: AccountCredentials }>();

  async list(): Promise<AccountMetadata[]> {
    return [...this.entries.values()].map(({ metadata }) => metadata);
  }

  async get(id: string): Promise<{ metadata: AccountMetadata; credentials: AccountCredentials }> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`No connected cPanel account has ID ${id}.`);
    return entry;
  }

  async add(input: { label: string; host: string; username: string; apiToken: string; tokenName?: string }): Promise<AccountMetadata> {
    const metadata: AccountMetadata = {
      id: randomUUID(),
      label: input.label,
      host: input.host,
      username: input.username,
      ...(input.tokenName ? { tokenName: input.tokenName } : {}),
      createdAt: new Date().toISOString(),
    };
    this.entries.set(metadata.id, {
      metadata,
      credentials: {
        host: input.host,
        username: input.username,
        apiToken: input.apiToken,
        ...(input.tokenName ? { tokenName: input.tokenName } : {}),
      },
    });
    return metadata;
  }

  async remove(id: string): Promise<AccountMetadata> {
    const entry = await this.get(id);
    this.entries.delete(id);
    return entry.metadata;
  }
}
