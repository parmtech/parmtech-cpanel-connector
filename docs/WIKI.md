![PARMTECH cPanel Connector — your hosting, your credentials](../assets/connector-banner.png)

# Your hosting. Your connector.

Connect a compatible AI or MCP client to **your own cPanel account** with software you run yourself. Choose a local setup for your computer or host your own remote OAuth server.

**[Read the setup guide →](SELF-HOSTING.md)** &nbsp; · &nbsp; **[Copy the AI assistant prompt →](SELF-HOSTING.md#copyable-prompt-for-your-ai-assistant)** &nbsp; · &nbsp; [Troubleshooting](SELF-HOSTING.md#troubleshooting-and-limits)

> [!IMPORTANT]
> This project is **alpha software**. PARMTECH's hosted endpoint is owner-restricted; setting up your own connector does not use it. Client support and availability vary.

---

## Choose your setup

| 🖥️ Local prototype | ☁️ Your own remote server |
|:---|:---|
| Run on your computer for a compatible local MCP client. | Run on infrastructure you control for a compatible remote MCP client. |
| **Needs:** Node.js 22.19+, npm and an OS credential store. | **Needs:** your HTTPS domain, Docker Compose, reverse proxy, SMTP and PostgreSQL storage. |
| **Access:** cPanel API token. | **Access:** cPanel or WHM; an API token is recommended. |
| **[Set up locally →](SELF-HOSTING.md#option-a-run-locally)** | **[Set up a remote server →](SELF-HOSTING.md#option-b-host-your-own-remote-connector)** |

The local prototype is cPanel-only. Its loopback HTTP endpoint has no OAuth and **must not be exposed publicly**. The remote server has its own connector login and OAuth flow. The two modes do not share saved accounts.

## From cPanel to your client

**1 · Prepare your account**

Create a dedicated API token in **your own cPanel**. Note your server hostname and cPanel username. Your hosting provider's interface and permissions may vary.

**2 · Set up your connector**

Follow the [local](SELF-HOSTING.md#option-a-run-locally) or [remote](SELF-HOSTING.md#option-b-host-your-own-remote-connector) instructions. For remote access, use a server and domain you control.

**3 · Add your hosting profile**

Enter the token in the local hidden prompt or your own connector's HTTPS settings form. The connector validates the credentials before saving them.

**4 · Connect and explore**

Connect a compatible MCP client and begin with read-only requests, such as listing connected accounts and domains. Grant write permissions only when needed.

> [!CAUTION]
> Never paste API tokens, passwords, verification codes, encryption keys or private configuration into an AI chat or GitHub issue. Keep your connector server, database backups and encryption key private: the server operator can decrypt saved hosting credentials.

---

## Need a hand?

The guide includes a ready-to-copy prompt that asks an AI assistant to walk you through setup without requesting your secrets.

**[Open the copyable assistant prompt →](SELF-HOSTING.md#copyable-prompt-for-your-ai-assistant)**

<details>
<summary><strong>Before relying on the remote server</strong></summary>

Remote hosting requires working email and a trusted HTTPS proxy. The hosted mode rejects private or loopback cPanel addresses. This alpha uses process-local rate limits, so run one app instance. Password recovery requires verified email; [offline key rotation](KEY-ROTATION.md) has important external-file limitations. Review the [security and operational limitations](SELF-HOSTING.md#troubleshooting-and-limits) before relying on it or offering it to other users.

</details>

<details>
<summary><strong>More documentation</strong></summary>

- [Complete setup and user guide](COMPLETE-GUIDE.md)
- [Security policy](../SECURITY.md)
- [Source code](https://github.com/parmtech/parmtech-cpanel-connector)

</details>

---

<sub>PARMTECH is independent. cPanel® and WHM® are third-party trademarks; this project is not presented as an official cPanel product.</sub>
