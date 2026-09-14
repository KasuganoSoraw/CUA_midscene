from __future__ import annotations

import json
import sys
import time

for raw_line in sys.stdin:
    request = json.loads(raw_line)
    payload = request["payload"]
    action = payload.get("action")
    if action == "crash":
        print("fake worker crashed", file=sys.stderr, flush=True)
        raise SystemExit(7)
    if action == "delay":
        time.sleep(2)
    if isinstance(action, str) and action.startswith("progress"):
        event = {
            "schemaVersion": "1.0",
            "requestId": "wrong-id" if action == "progress-invalid" else request["requestId"],
            "type": "event",
            "event": {
                "type": "execution.progress",
                "message": "Tap - username field",
                "data": {
                    "source": "midscene",
                    "taskIndex": 0,
                    "taskId": "task-1",
                    "action": "Tap",
                    "description": "username field",
                    "status": "running",
                },
            },
        }
        if action == "progress-bad-task-id":
            event["event"]["data"]["taskId"] = 1
        if action == "progress-long-description":
            event["event"]["data"]["description"] = "x" * 301
        if action == "progress-leak":
            event["event"]["data"]["screenshot"] = "private-image"
        print(json.dumps(event, ensure_ascii=False), flush=True)
        if action in ("progress-delay", "progress-cancel"):
            time.sleep(2)
    if action in ("error", "progress-error"):
        response = {
            "schemaVersion": "1.0",
            "requestId": request["requestId"],
            "ok": False,
            "error": {
                "code": "RUNTIME_METHOD_FAILED",
                "message": "fake runtime failure",
                "details": {"source": "fake"},
            },
        }
    else:
        response = {
            "schemaVersion": "1.0",
            "requestId": request["requestId"],
            "ok": True,
            "result": {"method": request["method"], "payload": payload},
        }
    print(json.dumps(response, ensure_ascii=False), flush=True)
