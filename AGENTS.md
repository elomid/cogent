# Cogent: notes for agents

## Installing Cogent for the user

Run:

```
curl -fsSL https://raw.githubusercontent.com/elomid/cogent/main/install.sh | sh
```

It clones to `~/.cogent` and links `skills/cogent` into `~/.claude/skills` and `~/.agents/skills` (Codex, Cursor, Gemini CLI and others read the latter). Verify with `python3 ~/.cogent/skills/cogent/cogent.py --help`, then tell the user a new session picks it up.

## Working on this repo

- The skill is `skills/cogent/`: `SKILL.md` (what agents follow), `cogent.py` (server and CLI, Python 3 standard library only), `layer.js` (the comment layer injected into served pages). Keep them together; `cogent.py` loads `layer.js` from its own folder.
- `.claude-plugin/marketplace.json` makes the repo installable as a Claude Code and Codex plugin. The plugin root is the repo root, and the skill is found under `skills/`.
- `install.sh` must stay POSIX `sh` and work both from a clone and piped from curl.
