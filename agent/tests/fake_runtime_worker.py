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
    if action == "error":
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
