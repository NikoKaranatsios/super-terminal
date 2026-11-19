FROM node:24-bookworm-slim
ARG CODEX_VERSION=0.164.0
ARG CLAUDE_VERSION=2.1.310
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends git python3 tmux ca-certificates curl chromium fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/st
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_VERSION}
COPY . ./
RUN mkdir -p /workspace && chown node:node /workspace
ENV HOME=/workspace/home SUPER_TERMINAL_AGENT_CONFIG=/workspace/bridge/config.json SUPER_TERMINAL_BROWSER=/usr/bin/chromium NODE_USE_ENV_PROXY=1
USER node
WORKDIR /workspace/repo
ENTRYPOINT ["node", "/opt/st/runner.mjs"]
