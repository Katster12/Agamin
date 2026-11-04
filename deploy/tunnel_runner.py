#!/usr/bin/env python3
"""Run a quick tunnel and publish its current URL to a small public Gist."""

from __future__ import annotations

import json
import re
import subprocess
import sys


GIST_ID = "12eee12c1e477a9120d8808ff6f03e64"
URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def publish(url: str) -> None:
    payload = json.dumps({"files": {"endpoint.json": {"content": json.dumps({"url": url}) + "\n"}}})
    subprocess.run(
        ["/usr/bin/gh", "api", "--method", "PATCH", f"/gists/{GIST_ID}", "--input", "-"],
        input=payload,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print(f"published tunnel endpoint {url}", flush=True)


def main() -> int:
    process = subprocess.Popen(
        [
            "/home/ubuntu/agamin_live_deploy/.tools/cloudflared", "tunnel",
            "--no-autoupdate", "--url", "http://127.0.0.1:8000",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    published = False
    assert process.stdout is not None
    for line in process.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        if not published:
            match = URL_PATTERN.search(line)
            if match:
                publish(match.group(0))
                published = True
    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
