# Search benchmark summary

Cases: 23 (19 action, 4 knowledge)

## Primary metrics
- **Server-P@1**: 14/19 (73.7%)
- **Server-P@3**: 17/19 (89.5%)
- **Tool-P@1** (trimmed top-3): 9/13 (69.2%)
- **Runnable-P@1**: 18/18 (100.0%)
- **Knowledge precision** (deflect): 4/4 (100.0%)

## By stratum (action cases)
- **lexical_easy**: P@1 8/10, P@3 8/10
- **lexical_hard**: P@1 3/3, P@3 3/3
- **conversational**: P@1 0/3, P@3 3/3
- **multi_valid**: P@1 2/2, P@3 2/2
- **discovery_only**: P@1 1/1, P@3 1/1

## Server-P@1 misses
- **action-postgres-query** (lexical_easy): top=zoho-recruit, P@3=no
  - Top 5: zoho-recruit, posthog, slackbot, slack, tallyfy-inc-mcp-server
- **conv-notify-deploy** (conversational): top=zoho-recruit, P@3=yes
  - Top 5: zoho-recruit, microsoft-teams, posthog, ateam-ai-ateam, shipstatic-ship
- **conv-uptime-check** (conversational): top=lindoai-mcp-server, P@3=yes
  - Top 5: lindoai-mcp-server, silentnw-website-auditor, joshuaogabriel-anchor-compliance, daniel-abbay-lead-enrichment, io-github-polnikale-sequenzy-mcp
- **conv-summarize-doc** (conversational): top=axel-belfort-ai-summarizer, P@3=yes
  - Top 5: axel-belfort-ai-summarizer, googledocs, amalgix-document-intelligence, dearlordylord-huly-mcp, dev-ko1g-rchilli
- **action-docker-container** (lexical_easy): top=posthog, P@3=no
  - Top 5: posthog, mailchimp, dearlordylord-huly-mcp, googlesuper, bugagent-bugagent-mcp