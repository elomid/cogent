#!/bin/sh
# Make Cogent a skill for your coding agents.
#
#   curl -fsSL https://raw.githubusercontent.com/elomid/cogent/main/install.sh | sh
#   ./install.sh                  from a clone: link it for every agent found
#   ./install.sh claude           only Claude Code   (~/.claude/skills)
#   ./install.sh agents           only Codex, Cursor, Gemini CLI and others (~/.agents/skills)
#
# It links (never copies) the skills/cogent folder, so updating the clone updates every agent.
set -e

repo_url="https://github.com/elomid/cogent"
here="$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)"

# Piped from curl (no checkout next to this script): clone or update ~/.cogent and use that.
if [ ! -f "$here/skills/cogent/SKILL.md" ]; then
  command -v git >/dev/null || { echo "Cogent needs git to install. Install git and run this again."; exit 1; }
  here="${COGENT_HOME:-$HOME/.cogent}"
  if [ -d "$here/.git" ]; then
    git -C "$here" pull --quiet --ff-only
  else
    git clone --quiet --depth 1 "$repo_url" "$here"
  fi
fi
skill="$here/skills/cogent"
command -v python3 >/dev/null || echo "Note: Cogent runs with python3, which isn't on your PATH yet."

# Which skill folders to link into. With no arguments, every agent that looks installed.
targets=""
if [ -n "$*" ]; then
  for a in "$@"; do
    case "$a" in
      claude) targets="$targets $HOME/.claude/skills" ;;
      agents|codex|cursor|gemini) targets="$targets $HOME/.agents/skills" ;;
      *) echo "Unknown agent: $a (use claude or agents)"; exit 1 ;;
    esac
  done
else
  [ -d "$HOME/.claude" ] && targets="$targets $HOME/.claude/skills"
  for d in .agents .codex .cursor .gemini; do
    if [ -d "$HOME/$d" ]; then targets="$targets $HOME/.agents/skills"; break; fi
  done
fi
[ -n "$targets" ] || { echo "No coding agents found. Name one: sh install.sh claude, or sh install.sh agents"; exit 1; }

for dir in $(printf '%s\n' $targets | sort -u); do
  mkdir -p "$dir"
  if [ -e "$dir/cogent" ] && [ ! -L "$dir/cogent" ]; then
    echo "Skipped $dir/cogent: a folder that isn't a link to Cogent is already there."
    continue
  fi
  ln -sfn "$skill" "$dir/cogent"
  echo "Linked $dir/cogent"
done

echo "Cogent is installed. Start a new agent session, then ask for an HTML page."
