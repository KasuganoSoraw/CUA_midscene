# -*- coding: utf-8 -*-
"""python -m cua_record 入口。

捕获处理异常并打印简短友好提示，避免把完整的 Python 堆栈
（对用户无意义的技术信息）转发到工作台日志。
"""

from __future__ import annotations

from .cli import main

try:
    raise SystemExit(main())
except Exception as exc:  # noqa: BLE001 - 面向用户的兜底提示
    message = str(exc).strip() or type(exc).__name__
    print(message, flush=True)
    raise SystemExit(1)
