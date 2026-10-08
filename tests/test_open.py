"""`cogent open` and the background server: a newer copy replaces an older running server, an equal one doesn't.

    python3 -m unittest discover tests

Runs its own servers on a spare port with their own state folder, so it never touches a server you're using.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SKILL = REPO / "skills" / "cogent"
PORT = "4390"


class OpenTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(dir=Path.home()))  # under ~, which the server serves
        self.env = {**os.environ, "XDG_STATE_HOME": str(self.tmp / "state"), "COGENT_PORT": PORT}
        self.page = self.tmp / "page" / "index.html"
        self.page.parent.mkdir()
        self.page.write_text("<!doctype html><title>t</title><h1>Hello</h1></html>")

    def tearDown(self):
        self.cogent(SKILL, "stop")
        shutil.rmtree(self.tmp, ignore_errors=True)

    def copy(self, name, version):
        """A second install of Cogent, at another version."""
        dest = self.tmp / name
        shutil.copytree(SKILL, dest)
        src = (dest / "cogent.py").read_text()
        (dest / "cogent.py").write_text(re.sub(r'^VERSION = "[^"]*"', f'VERSION = "{version}"', src, count=1, flags=re.M))
        return dest

    def cogent(self, skill, *args):
        return subprocess.run([sys.executable, str(skill / "cogent.py"), *args], env=self.env,
                              capture_output=True, text=True, timeout=20)

    def ping(self, url):
        port = re.match(r"http://localhost:(\d+)/", url).group(1)
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/__cogent/api/ping", timeout=2) as r:
            return json.load(r)

    def test_newer_copy_replaces_an_older_server(self):
        old = self.copy("old", "2000.01.01")
        url = self.cogent(old, "open", str(self.page)).stdout.strip()
        self.assertEqual(self.ping(url)["version"], "2000.01.01")

        url = self.cogent(SKILL, "open", str(self.page)).stdout.strip()
        ping = self.ping(url)
        self.assertNotEqual(ping["version"], "2000.01.01")
        self.assertEqual(Path(ping["path"]), SKILL)

        # The page it serves carries the newer layer.
        base = re.match(r"http://localhost(:\d+)/", url).group(1)
        with urllib.request.urlopen(f"http://127.0.0.1{base}/__cogent/layer.js", timeout=2) as r:
            self.assertEqual(r.read(), (SKILL / "layer.js").read_bytes())

    def test_older_or_equal_copy_keeps_the_running_server(self):
        url = self.cogent(SKILL, "open", str(self.page)).stdout.strip()
        pid = self.ping(url)["pid"]
        for name, version in (("same", re.search(r'^VERSION = "([^"]*)"', (SKILL / "cogent.py").read_text(), re.M).group(1)),
                              ("old", "2000.01.01")):
            self.cogent(self.copy(name, version), "open", str(self.page))
            self.assertEqual(self.ping(url)["pid"], pid, f"a {name} copy restarted the server")


if __name__ == "__main__":
    unittest.main()
