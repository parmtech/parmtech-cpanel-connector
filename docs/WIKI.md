![PARMTECH cPanel Connector](../assets/connector-banner.png)

# Your hosting. Your connector.

Connect a compatible MCP client to **your own cPanel account** using a connector you run yourself. The open-source project is an **alpha**. PARMTECH's hosted endpoint is owner-restricted; this guide does not require it.

> **Start here:** [Open the step-by-step setup guide](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/SELF-HOSTING.md) · [Copy the AI assistant prompt](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/SELF-HOSTING.md#copyable-prompt-for-your-ai-assistant)

## Choose how to run it

| | Local prototype | Your own remote server |
|---|---|---|
| Good for | A compatible client on your computer | A compatible remote MCP client |
| You need | Node.js 22.19+, npm, an OS credential store | Your HTTPS domain, Docker Compose, reverse proxy, SMTP and PostgreSQL storage |
| Hosting access | cPanel API token | cPanel or WHM; API token recommended |
| Runs | On your computer | On infrastructure you operate |

The local prototype is cPanel-only and its loopback HTTP endpoint has no OAuth: do not expose it publicly. The remote server uses its own connector login and OAuth. Client compatibility and availability vary.

## Get started

1. Create a dedicated API token in **your own cPanel** and note your server hostname and cPanel username. Your hosting provider's interface and permissions may vary.
2. Follow the [local setup](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/SELF-HOSTING.md#option-a-run-locally) or [remote setup](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/SELF-HOSTING.md#option-b-host-your-own-remote-connector) instructions. Use your own server and domain for the remote route.
3. Enter your token in the local hidden prompt or your own connector's HTTPS settings form. **Never paste a token, password, verification code or encryption key into an AI chat or GitHub issue.**
4. Connect a compatible MCP client and start with read-only requests, such as listing connected accounts and domains. Grant write permissions only when needed.

## What to know

The server operator can decrypt saved hosting credentials. Keep the server, database backups and stable encryption key private. Remote hosting requires working email and a trusted HTTPS proxy; the hosted mode rejects private or loopback cPanel addresses. This alpha has no automated password recovery or encryption-key rotation and uses process-local rate limits, so run one app instance. Review the [security and operational limitations](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/SELF-HOSTING.md#troubleshooting-and-limits) before relying on it or offering it to other users.

[Complete guide](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/docs/COMPLETE-GUIDE.md) · [Security policy](https://github.com/parmtech/parmtech-cpanel-connector/blob/main/SECURITY.md) · [Source code](https://github.com/parmtech/parmtech-cpanel-connector)

PARMTECH is independent. cPanel® and WHM® are third-party trademarks; this project is not presented as an official cPanel product.
