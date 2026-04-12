const express = require('express');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const app = express();
app.use(express.json());

// A simple auth token checks to prevent public abuse of the container
const AUTH_TOKEN = process.env.SANDBOX_AUTH_TOKEN || "dev-sandbox-token";

app.post('/extract', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { command, args, env } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: "Command is required" });
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
    { name: "agentrail-sandbox", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    // 1. Start the subprocess and connect
    await client.connect(transport);

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
  console.log(`Agentrail MCP Sandbox listening on port ${PORT}`);
});
