import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { SystemAccountStore } from "./store.js";
import { normalizeCpanelHost } from "./host.js";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("For security, connect from an interactive terminal so the API token can be entered without echo."));
  }
  return new Promise((resolve, reject) => {
    stdout.write(question);
    const wasRaw = stdin.isRaw;
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    let value = "";
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(Boolean(wasRaw));
      stdout.write("\n");
    };
    const onKeypress = (text: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Setup cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value.trim());
      } else if (key.name === "backspace" || key.name === "delete") {
        value = value.slice(0, -1);
      } else if (!key.ctrl && !key.sequence?.startsWith("\u001b")) {
        value += text;
      }
    };
    stdin.on("keypress", onKeypress);
  });
}

async function connect(): Promise<void> {
  stdout.write("PARMTECH cPanel Connector — secure account setup\n\n");
  stdout.write("First, sign in to cPanel and create an API token under Security → Manage API Tokens.\n");
  stdout.write("The token is validated against your account, then stored in your operating system credential store.\n\n");
  const label = await ask("Connection label (for example, Production): ");
  const rawHost = await ask("cPanel server host or address: ");
  const username = await ask("cPanel username: ");
  const tokenName = await ask("API token name (needed for one-click remote revocation; optional): ");
  const apiToken = await askSecret("API token (input hidden): ");
  const store = new SystemAccountStore();
  const account = await store.add({ label, host: normalizeCpanelHost(rawHost), username, apiToken, ...(tokenName ? { tokenName } : {}) });
  stdout.write(`Connected ${account.label} (${account.username} at ${account.host}).\n`);
  stdout.write(`Account ID: ${account.id}\n`);
  stdout.write("The API token was saved to the operating system credential store.\n");
}

async function list(): Promise<void> {
  const accounts = await new SystemAccountStore().list();
  if (!accounts.length) {
    stdout.write("No cPanel accounts are connected. Run `npm run setup` to connect one.\n");
    return;
  }
  for (const account of accounts) stdout.write(`${account.id}\t${account.label}\t${account.username}@${account.host}\n`);
}

async function disconnect(): Promise<void> {
  const store = new SystemAccountStore();
  const accounts = await store.list();
  if (!accounts.length) throw new Error("No cPanel accounts are connected.");
  for (const [index, account] of accounts.entries()) stdout.write(`${index + 1}. ${account.label} — ${account.username}@${account.host}\n`);
  const choice = Number(await ask("Select account number to disconnect: "));
  const account = accounts[choice - 1];
  if (!account) throw new Error("Choose a number from the list.");
  const remote = (await ask("Also revoke its cPanel API token remotely? [y/N]: ")).toLowerCase() === "y";
  if (remote) {
    const loaded = await store.get(account.id);
    if (!loaded.credentials.tokenName) throw new Error("No API token name was saved. Revoke the token in cPanel → Security → Manage API Tokens; the local connection was left intact.");
    const { UapiClient } = await import("./uapi.js");
    await new UapiClient().call(loaded.credentials, "Tokens", "revoke", { name: loaded.credentials.tokenName });
  }
  await store.remove(account.id);
  stdout.write(`Disconnected ${account.label}.`);
  if (!remote) stdout.write(" Revoke its API token in cPanel → Security → Manage API Tokens to disable it remotely.");
  stdout.write("\n");
}

const command = process.argv[2] ?? "connect";
try {
  if (command === "connect") await connect();
  else if (command === "list") await list();
  else if (command === "disconnect") await disconnect();
  else {
    stdout.write("Usage: npm run setup [-- connect|list|disconnect]\n");
    process.exitCode = 2;
  }
} catch (error) {
  stdout.write(`${error instanceof Error ? error.message : "Setup failed."}\n`);
  process.exitCode = 1;
}
