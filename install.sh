#!/bin/sh
# Make Cogent available as a skill to your coding agents.
#   ./install.sh                 link it for every agent found (Claude Code, Codex)
#   ./install.sh claude codex    link it only for the agents you name
set -e
here="$(cd "$(dirname "$0")" && pwd)"
agents="${*:-claude codex}"
done_any=""
for a in $agents; do
  case "$a" in
    claude) dir="$HOME/.claude/skills" ;;
    codex)  dir="${CODEX_HOME:-$HOME/.codex}/skills" ;;
    *) echo "Unknown agent: $a (use claude or codex)"; exit 1 ;;
  esac
  if [ -z "$*" ] && [ ! -d "$(dirname "$dir")" ]; then continue; fi   # that agent isn't installed
  mkdir -p "$dir"
  if [ -e "$dir/cogent" ] && [ ! -L "$dir/cogent" ]; then
    echo "Skipped $a: $dir/cogent exists and isn't a link to Cogent"; continue
  fi
  ln -sfn "$here" "$dir/cogent"
  echo "Cogent is now a skill for $a ($dir/cogent)"
  done_any=1
done
[ -n "$done_any" ] || echo "No agents found. Name one: ./install.sh claude"
