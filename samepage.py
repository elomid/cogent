#!/usr/bin/env python3
"""Samepage: comment on any HTML page an agent made, and let any agent read the comments.

    samepage serve [DIR] [--port 4300]     serve DIR with the comment layer added to every page
    samepage list PAGE [--all] [--json]    comments on PAGE (open ones by default)
    samepage take PAGE ID... --as NAME     mark comments as being worked on by NAME
    samepage reply PAGE ID TEXT --as NAME  reply to a comment (sets it to answered)
    samepage resolve PAGE ID...            mark comments resolved (normally the person does this)

PAGE is the HTML file on disk. Comments live next to it: index.html -> index.comments.json.
No dependencies beyond the Python standard library.
"""

import argparse
import contextlib
import datetime as dt
import fcntl
import getpass
import hashlib
import http.server
import json
import os
import socketserver
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAYER = HERE / "layer.js"
TAG = '<script src="/__samepage/layer.js" defer></script>'
PERSON = "you"


# ---------- the comments file ----------

def comments_path(page: Path) -> Path:
    return page.with_name(page.stem + ".comments.json")


@contextlib.contextmanager
def locked(page: Path):
    key = hashlib.sha1(str(comments_path(page)).encode()).hexdigest()[:16]
    with open(Path(tempfile.gettempdir()) / f"samepage-{key}.lock", "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def load(page: Path) -> dict:
    path = comments_path(page)
    if not path.exists():
        return {"page": page.name, "comments": []}
    return json.loads(path.read_text())


def save(page: Path, data: dict) -> None:
    path = comments_path(page)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def person() -> str:
    """The person's name on their comments: $SAMEPAGE_NAME, else the first name in git config, else the login."""
    if os.environ.get("SAMEPAGE_NAME"):
        return os.environ["SAMEPAGE_NAME"]
    try:
        name = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True).stdout.strip()
        if name:
            return name.split()[0].lower()
    except OSError:
        pass
    return getpass.getuser()


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def find(data: dict, cid: str) -> dict:
    for c in data["comments"]:
        if c["id"] == cid:
            return c
    raise SystemExit(f"No comment {cid}")


def page_version(page: Path) -> str:
    return dt.datetime.fromtimestamp(page.stat().st_mtime).isoformat(timespec="seconds")


def create(page: Path, target: dict, also: list, text: str, by: str) -> dict:
    with locked(page):
        data = load(page)
        n = max([int(c["id"][1:]) for c in data["comments"]] or [0]) + 1
        c = {
            "id": f"c{n}",
            "status": "open",
            "taken_by": None,
            "created": now(),
            "version": page_version(page),
            "target": target,
            "also": also,
            "thread": [{"by": by, "at": now(), "text": text}],
        }
        data["comments"].append(c)
        save(page, data)
        return c


def reply(page: Path, cid: str, text: str, by: str, person: bool) -> dict:
    with locked(page):
        data = load(page)
        c = find(data, cid)
        c["thread"].append({"by": by, "at": now(), "text": text})
        # A reply from the person puts the ball back with the agents; an agent's reply answers it.
        c["status"] = "open" if person else "answered"
        if person:
            c["taken_by"] = None
        save(page, data)
        return c


def set_status(page: Path, ids: list, status: str, by: str = None) -> list:
    with locked(page):
        data = load(page)
        changed = []
        for cid in ids:
            c = find(data, cid)
            c["status"] = status
            c["taken_by"] = by if status == "taken" else (c.get("taken_by") if status == "answered" else None)
            changed.append(c)
        save(page, data)
        return changed


# ---------- the server ----------

class Handler(http.server.SimpleHTTPRequestHandler):
    root: Path = Path(".")

    def log_message(self, fmt, *args):
        if not self.path.startswith("/__samepage/api/state"):
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def page_for(self, url_path: str) -> Path:
        rel = urllib.parse.unquote(url_path).lstrip("/")
        p = (self.root / rel).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError("outside the served folder")
        if p.is_dir():
            p = p / "index.html"
        return p

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/__samepage/layer.js":
            body = LAYER.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if url.path in ("/__samepage/api/comments", "/__samepage/api/state"):
            try:
                page = self.page_for(q.get("page", ["/"])[0])
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            if url.path.endswith("comments"):
                return self.send_json({**load(page), "user": PERSON})
            # What changed on disk: the page's folder (a rebuild) or its comments.
            cp = comments_path(page)
            files = [f for f in page.parent.iterdir() if f.is_file() and not f.name.endswith((".comments.json", ".tmp"))]
            return self.send_json({
                "files": max((f.stat().st_mtime for f in files), default=0),
                "comments": cp.stat().st_mtime if cp.exists() else 0,
            })
        # Pages get the layer added on the way out.
        try:
            page = self.page_for(url.path)
        except ValueError:
            return self.send_error(403)
        if page.suffix.lower() in (".html", ".htm") and page.exists():
            html = page.read_text(encoding="utf-8", errors="replace")
            i = html.lower().rfind("</body>")
            html = html[:i] + TAG + html[i:] if i >= 0 else html + TAG
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path != "/__samepage/api/comments":
            return self.send_error(404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        try:
            page = self.page_for(req.get("page", "/"))
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        me = PERSON
        act = req.get("action")
        try:
            if act == "create":
                c = create(page, req["target"], req.get("also") or [], req["text"], me)
            elif act == "reply":
                c = reply(page, req["id"], req["text"], me, person=True)
            elif act == "edit":
                with locked(page):
                    data = load(page)
                    c = find(data, req["id"])
                    mine = [m for m in c["thread"] if m["by"] == me]
                    if not mine:
                        return self.send_json({"error": "nothing of yours to edit"}, 400)
                    mine[-1]["text"] = req["text"]
                    mine[-1]["edited"] = now()
                    save(page, data)
            elif act == "delete":
                with locked(page):
                    data = load(page)
                    c = find(data, req["id"])
                    data["comments"] = [x for x in data["comments"] if x["id"] != req["id"]]
                    save(page, data)
            elif act in ("resolve", "reopen"):
                c = set_status(page, [req["id"]], "resolved" if act == "resolve" else "open")[0]
            elif act == "resolve_answered":
                ids = [c["id"] for c in load(page)["comments"] if c["status"] == "answered"]
                set_status(page, ids, "resolved") if ids else None
                c = {"resolved": ids}
            else:
                return self.send_json({"error": f"unknown action {act}"}, 400)
        except SystemExit as e:
            return self.send_json({"error": str(e)}, 404)
        return self.send_json(c)


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(root: Path, port: int):
    global PERSON
    PERSON = person()
    Handler.root = root.resolve()
    handler = lambda *a, **k: Handler(*a, directory=str(Handler.root), **k)
    for p in range(port, port + 20):
        try:
            httpd = Server(("127.0.0.1", p), handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit(f"No free port from {port} to {port + 19}")
    print(f"Samepage: serving {Handler.root} at http://localhost:{p}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


# ---------- the agent commands ----------

def describe(c: dict) -> str:
    t = c["target"]
    where = " › ".join(t.get("path") or []) or (f"under the heading \"{t['location']}\"" if t.get("location") else "(no named section)")
    lines = [f"{c['id']} · {c['status']}" + (f" by {c['taken_by']}" if c.get("taken_by") else "") + f" · made on page version {c['version']}"]
    lines.append(f"  where: {where} › {t.get('name')}")
    if t.get("css"):
        lines.append(f"  element: {t['css']}  (inside the section above)")
    if t.get("text"):
        lines.append(f"  its text: \"{t['text'][:160]}\"")
    if t.get("selection"):
        lines.append(f"  selected: \"{t['selection']}\"")
    for a in c.get("also") or []:
        lines.append(f"  also: {' › '.join(a.get('path') or [])} › {a.get('name')}")
    r = t.get("rect") or {}
    if r:
        lines.append(f"  box: x{r.get('x')} y{r.get('y')} {r.get('w')}×{r.get('h')} in a {t.get('viewport')}px-wide window")
    for m in c["thread"]:
        lines.append(f"  {m['by']}: {m['text']}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="samepage", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve"); s.add_argument("dir", nargs="?", default="."); s.add_argument("--port", type=int, default=4300)
    s = sub.add_parser("list"); s.add_argument("page"); s.add_argument("--all", action="store_true"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("take"); s.add_argument("page"); s.add_argument("ids", nargs="+"); s.add_argument("--as", dest="by", required=True)
    s = sub.add_parser("reply"); s.add_argument("page"); s.add_argument("id"); s.add_argument("text"); s.add_argument("--as", dest="by", required=True)
    s = sub.add_parser("resolve"); s.add_argument("page"); s.add_argument("ids", nargs="+")
    a = ap.parse_args(argv)

    if a.cmd == "serve":
        return serve(Path(a.dir), a.port)
    page = Path(a.page).resolve()
    if page.is_dir():
        page = page / "index.html"
    if a.cmd == "list":
        cs = load(page)["comments"]
        if not a.all:
            cs = [c for c in cs if c["status"] == "open"]
        if a.json:
            print(json.dumps(cs, indent=2, ensure_ascii=False))
        else:
            print("\n\n".join(describe(c) for c in cs) if cs else "No open comments.")
    elif a.cmd == "take":
        for c in set_status(page, a.ids, "taken", a.by):
            print(f"{c['id']} taken by {a.by}")
    elif a.cmd == "reply":
        c = reply(page, a.id, a.text, a.by, person=False)
        print(f"{c['id']} answered")
    elif a.cmd == "resolve":
        for c in set_status(page, a.ids, "resolved"):
            print(f"{c['id']} resolved")


if __name__ == "__main__":
    main()
