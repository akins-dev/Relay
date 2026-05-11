# @relay/cli

Runtime tool discovery for AI agents. One command to search, discover, and invoke any MCP server.

## Install

```bash
npm i -g @relay/cli
```

## Quick Start

```bash
# Find servers for a task
relay search "send a transactional email"

# Inspect a server's manifest
relay info sendgrid-mail

# Run a tool locally
relay invoke sendgrid-mail send_email --json '{"to":"user@example.com","subject":"Hello"}'
```

## For MCP-Native Agents (Claude Desktop, Cursor, Cline)

Add to your agent host config:

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["serve"]
    }
  }
}
```

The agent automatically receives three tools:

| Tool | What it does |
|---|---|
| `search_tools` | Find MCP servers matching an intent |
| `get_server_manifest` | Get the full manifest for a server |
| `invoke_tool` | Execute a tool — Relay handles subprocess lifecycle |

The agent learns when to search via the `instructions` field in the MCP handshake. No extra system prompt needed.

## For CLI-Capable Agents (Codex, Aider, custom)

Add the bootstrap prompt to your agent's system prompt:

```bash
relay bootstrap
```

Or generate the MCP config snippet:

```bash
relay bootstrap --mcp
```

## Configuration

Relay works out of the box with zero configuration. The defaults point to the production Relay Cloud.

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `RELAY_API_URL` | No | `https://relay.dev` | Relay Cloud base URL. Only change if self-hosting. |
| `RELAY_API_KEY` | No | *(none)* | Optional API key for higher rate limits. |

### API Key

**The API key is optional.** Anonymous access works.

A key gives you higher rate limits when the service is under heavy traffic. Get one free at [relay.dev](https://relay.dev).

**The AI agent never sees or handles the key.** It's infrastructure config between Relay Local and Relay Cloud, set by the human operator.

#### Setting it for MCP mode

```json
{
  "mcpServers": {
    "relay": {
      "command": "relay",
      "args": ["serve"],
      "env": {
        "RELAY_API_KEY": "sk_your_key"
      }
    }
  }
}
```

#### Setting it for CLI mode

```bash
export RELAY_API_KEY=sk_your_key
```

### Downstream Server Credentials

Relay does **not** manage downstream server credentials (GITHUB_TOKEN, SENDGRID_API_KEY, etc.). These live in your environment and are passed through to child processes automatically.

If a tool call fails because a credential is missing, Relay returns a structured error telling the agent exactly which env var to set.

## Commands

### `relay search <intent>`

Search for MCP servers matching an intent.

```bash
relay search "create a GitHub pull request" --limit 3
```

**Flags:**
- `--limit N` — Max results (default 5, max 20)
- `--raw` — Output raw API response

### `relay info <server>`

Get the full manifest for a server: launch command, env vars, tools, schemas.

```bash
relay info github
```

### `relay invoke <server> <tool>`

Invoke a tool on a discovered MCP server. Relay handles the subprocess.

```bash
relay invoke github create_pull_request --json '{"owner":"org","repo":"app","title":"feat: new thing","head":"feature","base":"main"}'
```

**Flags:**
- `--json '{}'` — Tool arguments as JSON
- `--timeout N` — Timeout in milliseconds (default 30000)

### `relay serve`

Start Relay as a local stdio MCP server. Agent hosts connect here.

```bash
relay serve
```

### `relay bootstrap`

Output agent configuration instructions.

```bash
relay bootstrap          # CLI agent system prompt
relay bootstrap --mcp    # MCP config JSON snippet
relay bootstrap --env    # Show env var documentation
```

## Architecture

Two adapters, one runtime:

```
CLI Agent  →  relay invoke  →  invokeTool()  →  Relay Cloud (manifest)
                                    ↓
MCP Agent  →  invoke_tool   →  invokeTool()  →  Child MCP Server (subprocess)
```

Both `relay invoke` and `invoke_tool` call the same `invokeTool()` function. No logic duplication.

## License

MIT
