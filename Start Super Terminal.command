#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.grok/bin:$PATH"
if curl -fsS http://127.0.0.1:4317/ >/dev/null 2>&1; then
  open http://127.0.0.1:4317/
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
npm run build || exit 1
(sleep 2; open http://127.0.0.1:4317/) &
npm start
