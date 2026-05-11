FROM node:20-bullseye-slim

# Install python and build tools which are often required for npx/pip stdio servers
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create non-root user — spawning arbitrary npx/pip as root is a privilege escalation risk
RUN groupadd --gid 1001 sandbox && \
    useradd --uid 1001 --gid sandbox --shell /bin/bash --create-home sandbox && \
    chown -R sandbox:sandbox /app
USER sandbox

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
