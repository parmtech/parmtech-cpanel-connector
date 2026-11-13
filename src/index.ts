import { execFile } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import express from "express";
import type { Request, Response } from "express";
import { SystemAccountStore } from "./store.js";
import { createCpanelMcpServer } from "./tools.js";
import { attachLocalSetupUi } from "./local-setup-ui.js";

const store = new SystemAccountStore();
const httpMode = process.argv.includes("--http") || process.argv.includes("--setup");

if (!httpMode) {
  const server = createCpanelMcpServer(store, undefined, undefined, { local: true });
  await server.connect(new StdioServerTransport());
} else {
  const host = "127.0.0.1";
  const port = Number(process.env.PORT ?? "3210");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  const app = createMcpExpressApp({ host });
  app.use("/setup", express.urlencoded({ extended: false, limit: "8kb" }));
  attachLocalSetupUi(app, store, port);

  app.post("/mcp", async (req: Request, res: Response) => {
    // MCP is for native clients. Browser pages must not invoke local tools.
    if (req.headers.origin) { res.sendStatus(403); return; }
    const server = createCpanelMcpServer(store, undefined, undefined, { local: true });
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "MCP request failed." });
      void server.close();
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => res.status(405).json({ error: "Use MCP Streamable HTTP POST." }));
  app.delete("/mcp", (_req: Request, res: Response) => res.status(405).json({ error: "Stateless MCP sessions cannot be deleted." }));
  app.get("/health", (_req: Request, res: Response) => res.json({ name: "PARMTECH cPanel Connector", status: "ok" }));

  const listener = app.listen(port, host, () => {
    console.error(`PARMTECH cPanel Connector MCP endpoint: http://${host}:${port}/mcp`);
    console.error(`Local setup page: http://${host}:${port}/setup`);
    console.error("Loopback only. Use ChatGPT Desktop local MCP or a supported Secure MCP Tunnel for ChatGPT access.");
    if (process.argv.includes("--setup") && process.platform === "win32") {
      execFile("rundll32.exe", ["url.dll,FileProtocolHandler", `http://${host}:${port}/setup`], { windowsHide: true }, () => undefined);
    }
  });
  listener.on("error", (error: NodeJS.ErrnoException) => {
    console.error(error.code === "EADDRINUSE" ? "The local port is already in use. Open the existing setup page or stop the other server." : "Could not start the local connector.");
    process.exitCode = 1;
  });
}
