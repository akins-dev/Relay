#!/bin/bash

echo "Fetching total MCP servers from Official Registry..."
echo "This may take a while if there are thousands of servers."

URL="https://registry.modelcontextprotocol.io/v0.1/servers"
TOTAL=0
CURSOR=""

while true; do
  if [ -z "$CURSOR" ]; then
    RESPONSE=$(curl -s "$URL?limit=100")
  else
    RESPONSE=$(curl -s "$URL?limit=100&cursor=$CURSOR")
  fi

  # Count servers in this page
  COUNT=$(echo "$RESPONSE" | jq -r '.servers | length')
  TOTAL=$((TOTAL + COUNT))

  # Get next cursor
  NEXT_CURSOR=$(echo "$RESPONSE" | jq -r '.metadata.nextCursor // empty')

  echo -ne "Servers counted so far: $TOTAL\r"

  # Break if no more pages
  if [ -z "$NEXT_CURSOR" ] || [ "$NEXT_CURSOR" = "null" ]; then
    break
  fi

  CURSOR="$NEXT_CURSOR"
done

echo -e "\n\n✅ Done!"
echo "Total MCP servers in Official Registry: **$TOTAL**"