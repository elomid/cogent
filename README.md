# Cogent

Comment directly on HTML pages that agents make, then tell any agent "read my comments". It knows which element each one is about, replies in the thread, and you resolve.

No install in the page. A small local server adds the comment layer as it serves the page and keeps comments in a file next to it (`index.html` → `index.comments.json`), so Claude, Codex or anything else that can read a file shares one record.

## Use

```
python3 cogent.py serve path/to/folder        # open the printed URL
```

In the page: press **C** and click anything, or select some words and click **Comment**. Pins show each thread; hover to preview, click to reply or resolve. Rebuilding the page reloads it, and comments follow their elements (or show as "Not on the page anymore").

## For agents

```
python3 cogent.py list page.html               # open comments
python3 cogent.py take page.html c1 c2 --as claude
python3 cogent.py reply page.html c1 "Changed to Connect…" --as claude
```

The full round, and how to build pages that comment well, is in [AGENTS.md](AGENTS.md).

Standard library Python 3 and one script file. No dependencies.
