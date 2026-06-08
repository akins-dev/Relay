# Relay: Runtime Discovery for MCP

Subtitle: solving the practical MCP configuration ceiling

Last updated: 2026-05-22
Status: external positioning draft — **MVP model is Relay Cloud discovery + Relay Local invoke** (no hosted cloud `invoke_tool`). See `SEARCH_PIPELINE.md` and `LAUNCH_AND_PUBLIC_TESTING.md` for current architecture.

## Abstract

MCP standardized how agents connect to tools. It did not solve how agents discover and safely use a large tool ecosystem at runtime without manual pre-configuration, schema bloat, and scattered trust boundaries.

Relay targets this gap.

Relay is not another directory. It is a runtime discovery layer that lets agents search capability by intent, receive a run manifest, invoke through Relay Local, and improve future routing from real outcomes.

The agent-facing surface stays deliberately small:

* `search_tools`
* `get_server_manifest`
* local Relay `invoke_tool` or `relay invoke`

Everything difficult happens behind that surface.

## The practical MCP cap

The core scaling problem in MCP is not raw server count. It is the amount of capability a team can use sanely under explicit configuration.

That ceiling appears early:

* humans still choose most servers up front
* schemas flood the model surface
* credentials and transport setup multiply with every server
* the agent can only use what has already been wired in
* there is little shared memory of what actually worked

This is not a protocol flaw. It is an architecture problem.

## What registries solve, and what they do not

The official MCP registry matters. Community directories matter too. They solve cataloging and discovery of metadata.

They do not solve the runtime problem by themselves:

* ranking for a live intent
* choosing what the agent sees now
* governing execution through one boundary
* learning from real search -> invoke outcomes

Relay is a runtime layer above the registry, not a registry replacement.

## Relay’s pattern

Relay follows one pattern:

**thin meta-layer + local guarded runtime + empirical feedback loop**

### Thin meta-layer

The agent does not need a thousand preloaded tools. It needs a small interface that lets it ask for capability when it needs it.

### Local guarded runtime (MVP)

Invocation runs on the agent host via Relay Local (`relay invoke`, `relay serve`). Cloud provides search, manifests, and optional outcome telemetry—not third-party tool execution. Future enterprise paths may add vault, DLP, and audit at the same boundary.

### Empirical feedback loop

Relay records search and invoke outcomes so routing improves from evidence, not just documentation.

## Why this matters now

MCP is not a niche protocol anymore.

By December 2025, project maintainers reported over 97 million monthly SDK downloads and 10,000 active servers, alongside first-class client support across major AI platforms. Since then, maintainers have kept pushing on transport scalability, governance maturity, enterprise readiness, and better discovery metadata. MCP now sits under the Agentic AI Foundation, a directed fund under the Linux Foundation, with a formal governance process and active working groups.

That is the good news.

The other side is that the attack surface is real now too. Recent security work has highlighted command-injection patterns around unsafe STDIO execution, prompt injection through tool surfaces, and the limits of trusting static metadata alone.

This environment demands a runtime governance layer.

## What Relay already does

Relay already has the right product skeleton:

* a native MCP server surface (`search_tools`, `get_server_manifest`)
* a canonical registry built from multiple upstream sources
* tool-level search (FTS + RRF on `server_tools`)
* Relay Local CLI and `relay serve` for invocation
* analytics tables (`search_events`, `invoke_outcomes`, `intent_server_mappings`) for measured routing improvements


## Where Relay fits today

Relay is infrastructure. It is not an all-purpose control plane.

It does one thing: it separates discovery from execution. We cast a wide net across the MCP ecosystem to index it, but we strictly govern what actually runs in the cloud. Just because a server exists doesn't mean it is safe to host remotely.

Relay is an HTTP-first runtime layer. It centralizes policy, manages credentials, enforces audit trails, and builds a routing feedback loop. We are solving a specific technical problem, not trying to wrap the entire protocol.

## What v1 looks to prove

We are not boiling the ocean. We are validating the runtime loop.

Success requires:
* ingest trustworthy metadata from a small set of solid sources
* expose one MCP connection
* search by intent
* invoke supported tools through one guarded path
* record outcomes
* document limitations clearly

If we hit these marks, Relay solves a real systems problem. A tight system that handles discovery, trust, and execution is better than a sprawling framework that fixes nothing.

## Protocol alignment

Relay's discovery layer evolves with MCP. We will not scrape directories indefinitely.

`.well-known` discovery and MCP Server Cards are critical. The protocol is moving to structured, pre-connection metadata. Servers will announce their identity, transports, and requirements upfront. This eliminates guesswork, fragile heuristics, and scraper-based registries.

Supporting server cards early shifts Relay from inferred metadata to authoritative protocol standards.

## Why `intent_server_mappings` matters

This table is more important than it looks.

Static registries can tell you what exists. They usually cannot tell you what worked for a given intent under real traffic.

`intent_server_mappings` is where Relay starts to become more than a directory:

* it captures evidence
* it makes routing compound over time
* it can produce useful aggregate public signals without exposing private usage data

That is the long-term product proof.

## The local-process boundary

A massive portion of MCP today is local-process-first. This is a hard boundary for hosted runtimes.

Remote HTTP and SSE servers fit behind a proxy. Arbitrary `stdio` servers do not. Running untrusted `stdio` commands in the cloud is a security vulnerability. 

Relay takes a hard line. We will index `stdio` servers for discovery, but we will not execute them in a shared cloud environment. We are building a CLI companion for secure local execution. We will not compromise security for comprehensiveness.

## The MCP roadmap

Relay is built for where MCP is going.

The protocol is deprecating stateful transports, formalizing discovery, and building out Tasks. Recent work on annotations provides a risk vocabulary, but annotations are not enforcement. They inform policy; they do not replace it.

Relay fills this gap. We keep the agent surface area small. We provide hard runtime guarantees: credential injection, policy enforcement, audit logging, and intelligent routing. As MCP becomes more expressive, Relay enforces the boundaries.

## Conclusion

Relay’s strongest claim is not "we indexed more servers" or "we added more security layers."

It is this:

**MCP needs a runtime layer that keeps the agent surface small, keeps execution governed, and learns from real use.**

This is a concrete infrastructure problem. It sits exactly between static registries and heavy orchestration frameworks. Relay builds that layer.

## References

- MCP joins the Agentic AI Foundation: https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/
- The 2026 MCP Roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- Expanding the MCP Maintainer Team: https://blog.modelcontextprotocol.io/posts/2026-04-08-maintainer-update/
- Tool Annotations as Risk Vocabulary: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- MCP Server Cards SEP: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1649
- OX Security MCP advisory: https://www.ox.security/blog/mcp-supply-chain-advisory-rce-vulnerabilities-across-the-ai-ecosystem/
