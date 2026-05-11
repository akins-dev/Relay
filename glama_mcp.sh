#!/bin/bash

BASE_URL="https://glama.ai/api/mcp/v1"
LIMIT=50

echo "🔍 Glama MCP Directory API Explorer"
echo "=================================="

# 1. Search servers
search_mcp() {
    local query="$1"
    echo -e "\nSearching for: '$query'\n"
    
    curl -s "$BASE_URL/servers?search=$query&limit=$LIMIT" | jq '.'
}

# 2. Get specific server details (includes endpoint URL)
get_server() {
    local owner_repo="$1"  # e.g. owner/repo or full name
    echo -e "\nFetching details for: $owner_repo\n"
    
    curl -s "$BASE_URL/servers/$owner_repo" | jq '.'
}

# 3. List popular/recent servers
list_servers() {
    echo -e "\nFetching recent servers...\n"
    curl -s "$BASE_URL/servers?limit=$LIMIT&sort=recent" | jq '.servers[] | {name, description, url: .endpoint_url}'
}

echo "Usage examples:"
echo "  ./glama_mcp.sh search \"github\""
echo "  ./glama_mcp.sh server \"owner/repo\""
echo "  ./glama_mcp.sh list"
echo "=================================="

# Handle arguments
case "$1" in
    search)
        search_mcp "$2"
        ;;
    server)
        get_server "$2"
        ;;
    list)
        list_servers
        ;;
    *)
        echo "Please use: search, server, or list"
        ;;
esac