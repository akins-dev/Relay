const express = require('express');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const app = express();
app.use(express.json());
const ALLOWED_COMMANDS = new Set(['npx']);
const MAX_ARG_COUNT = 16;

// Auth token — REQUIRED in all environments. No insecure fallbacks.
const AUTH_TOKEN = process.env.SANDBOX_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error('[sandbox] FATAL: SANDBOX_AUTH_TOKEN env var is required');
  process.exit(1);
}

app.post('/extract', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { command, args, env } = req.body;
  
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: "Command is required and must be a string" });
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    return res.status(400).json({ error: "command is not allowed" });
  }

  // Validate args is an array of strings
  if (args !== undefined && (!Array.isArray(args) || !args.every(a => typeof a === 'string'))) {
    return res.status(400).json({ error: "args must be an array of strings" });
  }
  if ((args || []).length > MAX_ARG_COUNT) {
    return res.status(400).json({ error: `args must have at most ${MAX_ARG_COUNT} items` });
  }

  // Validate env is an object of string key-value pairs
  if (env !== undefined && (typeof env !== 'object' || env === null || Array.isArray(env) ||
      !Object.entries(env).every(([k, v]) => typeof k === 'string' && typeof v === 'string'))) {
    return res.status(400).json({ error: "env must be an object of string key-value pairs" });
  }

  console.log(`[extract] Spawning: ${command} ${args ? args.join(' ') : ''}`);

  const transport = new StdioClientTransport({
    command,
    args: args || [],
    env: {
      ...process.env,
      ...(env || {})
    }
  });

  const client = new Client(
    { name: "relay-sandbox", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    // 1. Start the subprocess and connect (with 30s timeout)
    const connectTimeout = AbortSignal.timeout(30_000);
    await Promise.race([
      client.connect(transport),
      new Promise((_, reject) => connectTimeout.addEventListener('abort', () =>
        reject(new Error('Connection timed out after 30s'))
      ))
    ]);

    // 2. Extract tools
    let tools = [];
    try {
      const toolsResult = await client.listTools();
      tools = toolsResult.tools || [];
    } catch (e) {
      console.warn(`[extract] Could not list tools: ${e.message}`);
    }

    // 3. Extract resources
    let resources = [];
    try {
      const resourcesResult = await client.listResources();
      resources = resourcesResult.resources || [];
    } catch (e) {
      console.warn(`[extract] Could not list resources: ${e.message}`);
    }

    // 4. Extract prompts
    let prompts = [];
    try {
      const promptsResult = await client.listPrompts();
      prompts = promptsResult.prompts || [];
    } catch (e) {
      console.warn(`[extract] Could not list prompts: ${e.message}`);
    }

    // 5. Clean up
    await client.close();

    console.log(`[extract] Success: ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`);

    return res.json({
      success: true,
      data: {
        tools,
        resources,
        prompts
      }
    });

  } catch (error) {
    console.error(`[extract] Error:`, error);
    // Ensure we attempt to cleanly close the transport if connect failed partway
    try {
      await client.close();
    } catch (e) {}

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to extract primitives from stdio server"
    });
  }
});

// Simple healthcheck
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`relay MCP Sandbox listening on port ${PORT}`);
});
