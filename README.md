# Cogent

Comment directly on HTML pages that agents make, then tell any agent "read my comments". It knows which element each one is about, replies in the thread, and you resolve.

Nothing goes into the page. A small local server adds the comment layer as it serves the page and keeps comments in a file next to it (`index.html` → `index.comments.json`), so Claude, Codex or any agent that can run a command shares one record.

## Install

Tell your coding agent:

> Install the Cogent skill from https://github.com/elomid/cogent

Or run this yourself:

```
curl -fsSL https://raw.githubusercontent.com/elomid/cogent/main/install.sh | sh
```

It clones Cogent to `~/.cogent` and links it for every agent it finds: Claude Code (`~/.claude/skills`), and Codex, Cursor, Gemini CLI and others (`~/.agents/skills`). Then start a new agent session. Running the same line again updates it. Needs `git` and Python 3, nothing else.

<details>
<summary>Other ways to install</summary>

**Claude Code plugin**

```
claude plugin marketplace add elomid/cogent
claude plugin install cogent@cogent
```

Or inside a session: `/plugin marketplace add elomid/cogent`, then `/plugin install cogent@cogent` and `/reload-plugins`.

**Codex plugin**

```
codex plugin marketplace add elomid/cogent
codex plugin add cogent@cogent
```

**Any agent, with Node**

```
npx skills add elomid/cogent -g -y -a claude-code -a codex -a cursor -a gemini-cli
```

**From a clone you keep**

```
git clone https://github.com/elomid/cogent ~/cogent && ~/cogent/install.sh
```

Update with `git -C ~/cogent pull`. `./install.sh claude` or `./install.sh agents` links only one side.

</details>

## For agents installing Cogent

If the user asked you to install this skill:

1. Run `curl -fsSL https://raw.githubusercontent.com/elomid/cogent/main/install.sh | sh`. If you can't run a piped script, clone the repo to `~/.cogent` and run `~/.cogent/install.sh` instead.
2. Check it worked: `python3 ~/.cogent/skills/cogent/cogent.py --help` prints usage, and `~/.claude/skills/cogent` or `~/.agents/skills/cogent` links to `~/.cogent/skills/cogent`.
3. Tell the user it's installed and that a new session picks it up (in Claude Code, `/reload-skills` works too). Then they can ask for an HTML page and get a link they can comment on.

## Use

Ask your agent for an HTML page as usual. With the skill installed, it hands you a `localhost` link instead of a file.

In the page:

- Press **C** and click anything, or select some words and click **Comment**.
- Pins mark each thread. Hover one to preview it, click it to reply or resolve.
- **10 comments** at the top right lists them all.

When you're done, tell the agent "read my comments". It answers in each thread, and the page reloads with its changes.

## Without an agent

```
python3 skills/cogent/cogent.py open page.html    # prints the page's Cogent URL
python3 skills/cogent/cogent.py list page.html    # open comments
python3 skills/cogent/cogent.py stop              # stop the background server
```

## What it runs on your machine

Installing Cogent gives your agent a skill that runs `skills/cogent/cogent.py`: a small Python server on `localhost` that adds the comment layer to pages it serves. It listens only on your own machine, serves files under your home folder, and never serves hidden files or folders (like `~/.ssh`) or folder listings. Skills run with your agent's permissions, so read [`skills/cogent/`](skills/cogent/) before installing, as you would any software.

What agents follow is in [skills/cogent/SKILL.md](skills/cogent/SKILL.md).
