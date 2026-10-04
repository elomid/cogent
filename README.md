# Cogent

Comment directly on HTML pages that agents make, then tell any agent "read my comments". It knows which element each one is about, replies in the thread, and you resolve.

Nothing goes into the page. A small local server adds the comment layer as it serves the page and keeps comments in a file next to it (`index.html` → `index.comments.json`), so Claude, Codex or any agent that can run a command shares one record.

## Install

Cogent is an agent skill. Clone it anywhere and link it into your agents:

```
git clone https://github.com/elomid/cogent ~/cogent
~/cogent/install.sh
```

`install.sh` links it for every agent it finds (Claude Code, Codex). To pick: `~/cogent/install.sh claude`. To update later: `git -C ~/cogent pull`.

Requires Python 3. No other dependencies.

## Use

Ask your agent for an HTML page as usual. With the skill installed, it hands you a `localhost` link instead of a file.

In the page:

- Press **C** and click anything, or select some words and click **Comment**.
- Pins mark each thread. Hover one to preview it, click it to reply or resolve.
- **10 comments** at the top right lists them all.

When you're done, tell the agent "read my comments". It answers in each thread, and the page reloads with its changes.

## Without an agent

```
python3 cogent.py open page.html        # prints the page's Cogent URL
python3 cogent.py list page.html        # open comments
python3 cogent.py stop                  # stop the background server
```

Cogent's server listens only on your own machine, serves files under your home folder, and never serves hidden files or folders (like `~/.ssh`) or folder listings.

What agents follow is in [SKILL.md](SKILL.md).
