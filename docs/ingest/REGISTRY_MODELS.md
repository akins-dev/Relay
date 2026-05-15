# Registry Extraction & Business Models

> **Context**: While `ARCHITECTURE.md` details how the Relay pipeline ingests data *from* third-party registries, this document outlines how those external registries operate internally to acquire their servers and sustain their platforms.

---

## 1. Smithery.ai

### Ingestion & Maintenance Model
Smithery acts as a centralized registry and deployment hub for MCP servers. 
- **Developer-Driven Publishing:** Rather than aggressively scraping GitHub, Smithery relies heavily on developers manually publishing and submitting their MCP servers to the platform.
- **Extraction Protocol:** When an MCP server is published, Smithery connects to it (either locally via their CLI or remotely via their hosting infrastructure) and performs an MCP handshake. It uses standard MCP requests (`tools/list`, `resources/list`) to extract the exact JSON schemas and capabilities. 
- **Verification:** Smithery maintains manual or semi-automated review processes. They explicitly flag servers they build and maintain themselves (the `bySmithery` flag) and servers that pass their quality checks (the `verified` flag).

### Business Model
Smithery's exact pricing tiers are currently kept under wraps (they do not have a public, standardized pricing page), but their model is clear: **Proprietary Managed Hosting**.
- **Open-Core:** They provide an open-source CLI and SDK for developers to build and test locally for free.
- **Monetization:** They monetize the "messy" parts of AI tool integration—hosting the servers, managing complex OAuth flows, handling secure token refreshes, and providing observability/gateways. As the ecosystem matures, they are positioning themselves to charge enterprises for secure, zero-config managed hosting of these remote MCP endpoints.

---

## 2. Glama.ai

### Ingestion & Maintenance Model
Glama operates a massive, searchable marketplace and acts as an AI Gateway.
- **Aggressive Scanning:** Unlike Smithery, Glama actively scans GitHub and other open-source registries to automatically index thousands of MCP servers. They ingest repository metadata (like `package.json`, `README`s, and SPDX licenses) to build their directory.
- **Automated Verification:** They automatically rank and verify these scraped repositories based on safety, quality, and popularity. 
- **Hosted Connectors:** To extract the actual tool schemas, Glama provides an in-browser "MCP Inspector" that allows them (and the user) to dynamically connect to the server and introspect its capabilities without requiring local installation.

### Business Model
Glama has a very transparent, **Subscription & Consumption-based (Credit)** business model. They act as a unified AI workspace (similar to a unified ChatGPT/Claude UI) with MCP tools built-in.
- **Subscription Tiers:** They offer Starter ($9/mo), Pro ($26/mo), and Business ($80/mo) plans.
- **AI Credits:** Subscriptions grant "AI Credits." Users spend these credits dynamically as they route prompts through Glama’s AI Gateway to models like GPT-4o or Claude 3.5 Sonnet.
- **Value-Add:** They monetize power users by offering advanced features locked behind higher tiers: hosted MCP servers, project-based memory, document analysis, detailed cost tracking, and team collaboration.
