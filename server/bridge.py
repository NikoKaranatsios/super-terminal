#!/usr/bin/env python3
"""Agent mailbox and isolated browser client; Python standard library only."""
import argparse
import base64
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("command", choices=["peers", "inbox", "send", "context", "progress", "browser"])
parser.add_argument("action", nargs="?", help="Browser: open, snapshot, click, fill, press, scroll, screenshot, close")
parser.add_argument("--to", help="Peer session ID, or coordinator")
parser.add_argument("--message")
parser.add_argument("--url")
parser.add_argument("--selector")
parser.add_argument("--text")
parser.add_argument("--key")
parser.add_argument("--goal", help="Goal ID; defaults to this agent's assigned goal")
parser.add_argument("--status", choices=["todo", "doing", "done"])
parser.add_argument("--notes", help="Progress or verification evidence")
args = parser.parse_args()
try:
    config = json.loads(pathlib.Path(os.environ["SUPER_TERMINAL_AGENT_CONFIG"]).read_text())
    payload = vars(args)
    request = urllib.request.Request(config["url"] + "/api/agent", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Super-Terminal-Agent": config["token"], "Host": config["hostHeader"]})
    with urllib.request.urlopen(request, timeout=65) as response:
        result = json.load(response)
    if "image" in result:
        image = pathlib.Path.home() / ".super-terminal" / "screenshots" / (config["id"] + ".png")
        image.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(base64.b64decode(result.pop("image")))
        result["screenshot"] = str(image)
    print(json.dumps(result, ensure_ascii=False, indent=2))
except urllib.error.HTTPError as error:
    print(error.read().decode(), file=sys.stderr)
    sys.exit(1)
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
