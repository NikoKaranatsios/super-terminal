#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.grok/bin:$PATH"
if [[ -d "$HOME/Applications/Super Terminal.app" ]]; then
  open "$HOME/Applications/Super Terminal.app"
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm install || exit 1
fi
npm run install:desktop || exit 1
open "$HOME/Applications/Super Terminal.app"
