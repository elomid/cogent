#!/usr/bin/env python3
"""Cogent: comment on any HTML page an agent made, and let any agent read the comments.

    cogent open PAGE                     print a URL for PAGE with the comment layer (starts the server if needed)
    cogent stop                          stop the background server
    cogent serve [DIR] [--port 4300]     serve one folder in the foreground instead
    cogent list PAGE [--all] [--json]    comments on PAGE (open ones by default)
    cogent take PAGE ID... --as NAME     mark comments as being worked on by NAME
    cogent reply PAGE ID TEXT --as NAME  reply to a comment (sets it to answered)
    cogent resolve PAGE ID...            mark comments resolved (normally the person does this)

PAGE is the HTML file on disk, or its Cogent URL. Comments live next to it: index.html -> index.comments.json.
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
import signal
import socketserver
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAYER = HERE / "layer.js"
TAG = '<script src="/__cogent/layer.js" defer></script>'
PERSON = "you"
STATE = Path.home() / ".cogent" / "server.json"   # the background server started by `open`
PORT = 4300


# ---------- the comments file ----------

def comments_path(page: Path) -> Path:
    return page.with_name(page.stem + ".comments.json")


@contextlib.contextmanager
def locked(page: Path):
    key = hashlib.sha1(str(comments_path(page)).encode()).hexdigest()[:16]
    with open(Path(tempfile.gettempdir()) / f"cogent-{key}.lock", "w") as fh:
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
    """The person's name on their comments: $COGENT_NAME, else the first name in git config, else the login."""
    if os.environ.get("COGENT_NAME"):
        return os.environ["COGENT_NAME"]
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
        if not self.path.startswith("/__cogent/api/state"):
            sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def page_for(self, url_path: str) -> Path:
        rel = urllib.parse.unquote(url_path).lstrip("/")
        if any(part.startswith(".") for part in rel.split("/")):
            raise ValueError("hidden paths are not served")
        p = (self.root / rel).resolve()
        if self.root not in p.parents and p != self.root:
            raise ValueError("outside the served folder")
        if p.is_dir():
            p = p / "index.html"
        return p

    def list_directory(self, path):
        self.send_error(404, "No folder listings")
        return None

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
        if url.path == "/__cogent/api/ping":
            return self.send_json({"cogent": True, "root": str(self.root)})
        if any(part.startswith(".") for part in urllib.parse.unquote(url.path).split("/") if part != "__cogent"):
            return self.send_error(404)
        if url.path == "/__cogent/layer.js":
            body = LAYER.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if url.path in ("/__cogent/api/comments", "/__cogent/api/state"):
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
        if self.path != "/__cogent/api/comments":
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


def serve(root: Path, port: int, state: bool = False):
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
    print(f"Cogent: serving {Handler.root} at http://localhost:{p}/", flush=True)
    if state:
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(json.dumps({"port": p, "pid": os.getpid(), "root": str(Handler.root)}))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if state and STATE.exists() and json.loads(STATE.read_text()).get("pid") == os.getpid():
            STATE.unlink()


# ---------- the background server ----------

def running():
    """The background server's state, if it's up and answering."""
    try:
        st = json.loads(STATE.read_text())
        with urllib.request.urlopen(f"http://127.0.0.1:{st['port']}/__cogent/api/ping", timeout=1) as r:
            if json.load(r).get("cogent"):
                return st
    except Exception:
        pass
    return None


def ensure_server():
    st = running()
    if st:
        return st
    log = STATE.parent / "server.log"
    STATE.parent.mkdir(exist_ok=True)
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "serve", str(Path.home()), "--port", str(PORT), "--state"],
                     stdout=open(log, "a"), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(50):
        time.sleep(0.1)
        st = running()
        if st:
            return st
    raise SystemExit(f"Cogent's server didn't start; see {log}")


def url_for(page: Path) -> str:
    st = ensure_server()
    root = Path(st["root"])
    if root not in page.parents:
        raise SystemExit(f"{page} isn't under {root}, so Cogent can't serve it")
    rel = page.relative_to(root).as_posix()
    if any(part.startswith(".") for part in rel.split("/")):
        raise SystemExit(f"{page} is inside a hidden folder, which Cogent doesn't serve")
    return f"http://localhost:{st['port']}/" + urllib.parse.quote(rel)


def page_arg(arg: str) -> Path:
    """A page given as a file, a folder, or its Cogent URL."""
    if arg.startswith(("http://localhost", "http://127.0.0.1")):
        st = running() or {"root": str(Path.home())}
        rel = urllib.parse.unquote(urllib.parse.urlparse(arg).path).lstrip("/")
        page = Path(st["root"]) / rel
    else:
        page = Path(arg).expanduser().resolve()
    return page / "index.html" if page.is_dir() else page


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
    ap = argparse.ArgumentParser(prog="cogent", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("open"); s.add_argument("page")
    sub.add_parser("stop")
    s = sub.add_parser("serve"); s.add_argument("dir", nargs="?", default="."); s.add_argument("--port", type=int, default=PORT)
    s.add_argument("--state", action="store_true", help=argparse.SUPPRESS)
    s = sub.add_parser("list"); s.add_argument("page"); s.add_argument("--all", action="store_true"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("take"); s.add_argument("page"); s.add_argument("ids", nargs="+"); s.add_argument("--as", dest="by", required=True)
    s = sub.add_parser("reply"); s.add_argument("page"); s.add_argument("id"); s.add_argument("text"); s.add_argument("--as", dest="by", required=True)
    s = sub.add_parser("resolve"); s.add_argument("page"); s.add_argument("ids", nargs="+")
    a = ap.parse_args(argv)

    if a.cmd == "serve":
        return serve(Path(a.dir), a.port, a.state)
    if a.cmd == "stop":
        st = running()
        if not st:
            return print("Cogent's server isn't running.")
        os.kill(st["pid"], signal.SIGINT)
        return print("Stopped Cogent's server.")
    page = page_arg(a.page)
    if a.cmd == "open":
        if not page.exists():
            raise SystemExit(f"No such page: {page}")
        return print(url_for(page))
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
