FROM node:22-slim

WORKDIR /app

# Install tini, curl, and Docker CLI (for container management)
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini curl ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN rm -rf node_modules && npm ci && npm cache clean --force

COPY . .

# Data directory for SQLite, SSH keys, etc.
VOLUME /app/data

HEALTHCHECK CMD curl -f http://localhost:${PORT:-1337}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
