# Relay Sandbox

The **Sandbox** is a lightweight, isolated Node.js Express microservice that bridges the gap between secure web environments and command-line MCP servers.

## When does this get used?

This service is used **exclusively during the ingestion pipeline (`/api/ingest`)**. 

When Relay ingests a server marked with the `stdio` transport, it means the server is not an HTTP endpoint. It is a piece of code that must be executed via the command line, typically through a known package entrypoint such as Smithery or a repo-root npm package. If Relay cannot derive a safe executable command, ingestion falls back to README parsing instead of guessing.

Because serverless environments like Vercel cannot safely spawn child Unix processes or execute random `npx` / `pip` packages without severe security and architecture tradeoffs, Relay offloads this task to this Sandbox.

1. `ingest.ts` sends a secure HTTP POST to the Sandbox with the CLI command. 
2. The Sandbox spawns the subprocess and attaches native `stdin/stdout`.
3. The Sandbox completes the MCP handshake, extracts the schemas (Tools, Resources, Prompts) via RPC, and shuts the process down. 
4. The Sandbox returns only the safe JSON schemas back to the main Relay database.

---

## Deployment Instructions (Render.com)

The `/sandbox` folder is completely set up with a `Dockerfile` that includes Node and native Python dependencies (necessary for many `stdio` MCP wrapper tools executed via `uv` or `pip`).

Here is the exact step-by-step to get this Sandbox live on Render:

### Step 1: Deploy the Service
1. Log into your **Render.com** dashboard.
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository containing the `Relay` code.
4. **CRITICAL:** When configuring the service, look for the field called **Root Directory** and type: `sandbox`
5. Render should automatically detect the runtime as **Docker** (because it finds `sandbox/Dockerfile`). If asked explicitly, select Docker.

### Step 2: Secure the Service
Scroll down to the Environment Variables section and add one single key:
- **Key**: `SANDBOX_AUTH_TOKEN`
- **Value**: *(Type a random, strong secret password here. For example: `super-secret-sandbox-token-123!`. Save this.)*

### Step 3: Link it to your Database
1. Click **Deploy Web Service** and wait a few minutes for Render to build the docker image.
2. Once deployed, copy the public URL Render assigns to the service (e.g., `https://mcp-sandbox-xyz.onrender.com`).
3. Add these two variables to your primary `.env` (locally, and in your Vercel project settings):

```env
SANDBOX_URL=https://mcp-sandbox-xyz.onrender.com
SANDBOX_AUTH_TOKEN=super-secret-sandbox-token-123!
```

Once linked, future ingestion runs will automatically query the sandbox for `stdio` servers when the registry has a safe execution strategy. Otherwise, the ingest pipeline falls back to README extraction and description enrichment.
