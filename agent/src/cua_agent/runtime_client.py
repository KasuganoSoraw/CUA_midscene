"""调用 TypeScript JSONL Runtime bridge 的 invocation 级客户端。"""

from __future__ import annotations

import asyncio
import json
import os
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, TypeAlias
from uuid import uuid4

from .contracts import JsonValue

RuntimeMethod: TypeAlias = Literal["catalog", "execute", "workbench"]
CancellationCheck: TypeAlias = Callable[[], bool]


class RuntimeClientProtocol(Protocol):
    async def request(
        self,
        method: RuntimeMethod,
        payload: Mapping[str, JsonValue],
        *,
        cancelled: CancellationCheck | None = None,
    ) -> dict[str, JsonValue]: ...


class ManagedRuntimeClientProtocol(RuntimeClientProtocol, Protocol):
    async def __aenter__(self) -> RuntimeClientProtocol: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object | None,
    ) -> None: ...


class RuntimeClientError(RuntimeError):
    """所有 Runtime bridge 客户端错误的基类。"""


class RuntimeConfigurationError(RuntimeClientError):
    pass


class RuntimeProtocolError(RuntimeClientError):
    pass


class RuntimeMethodError(RuntimeClientError):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, JsonValue] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class RuntimeProcessError(RuntimeClientError):
    pass


class RuntimeTimeoutError(RuntimeClientError):
    pass


class RuntimeCancelledError(RuntimeClientError):
    pass


@dataclass(frozen=True, slots=True)
class RuntimeProcessConfig:
    """由安装环境提供的 Runtime worker 启动配置。"""

    command: tuple[str, ...]
    cwd: str | None = None
    env: Mapping[str, str] | None = None
    request_timeout_seconds: float = 300.0
    shutdown_timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        if not self.command or any(not item.strip() for item in self.command):
            raise RuntimeConfigurationError("Runtime command 必须包含非空 executable 和参数")
        if self.request_timeout_seconds <= 0:
            raise RuntimeConfigurationError("request timeout 必须大于 0")
        if self.shutdown_timeout_seconds <= 0:
            raise RuntimeConfigurationError("shutdown timeout 必须大于 0")

    @classmethod
    def from_runtime(
        cls,
        runtime_executable: str | Path,
        bridge_script: str | Path,
        **kwargs: object,
    ) -> RuntimeProcessConfig:
        runtime_path = Path(runtime_executable)
        script_path = Path(bridge_script)
        for value, name in (
            (runtime_path, "JavaScript Runtime executable"),
            (script_path, "Runtime bridge"),
        ):
            if not value.is_absolute():
                raise RuntimeConfigurationError(f"{name} 必须是绝对路径：{value}")
            if not value.is_file():
                raise RuntimeConfigurationError(f"{name} 不存在：{value}")
        return cls(command=(str(runtime_path), str(script_path)), **kwargs)  # type: ignore[arg-type]

    @classmethod
    def from_paths(
        cls,
        node_executable: str | Path,
        bridge_script: str | Path,
        **kwargs: object,
    ) -> RuntimeProcessConfig:
        return cls.from_runtime(node_executable, bridge_script, **kwargs)


class JsonlRuntimeClient:
    """一个 Agent invocation 内复用一个 Node Runtime worker。"""

    def __init__(
        self,
        config: RuntimeProcessConfig,
        *,
        create_request_id: Callable[[], str] | None = None,
    ) -> None:
        self._config = config
        self._create_request_id = create_request_id or (lambda: str(uuid4()))
        self._process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr_lines: deque[str] = deque(maxlen=30)
        self._request_lock = asyncio.Lock()

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def stderr_summary(self) -> str:
        return "\n".join(self._stderr_lines)

    async def __aenter__(self) -> JsonlRuntimeClient:
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: object | None,
    ) -> None:
        await self.close()

    async def start(self) -> None:
        if self.running:
            return
        if self._process is not None:
            raise RuntimeProcessError(self._process_exit_message())

        environment = None
        if self._config.env is not None:
            environment = {**os.environ, **self._config.env}
        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._config.command,
                cwd=self._config.cwd,
                env=environment,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as error:
            raise RuntimeProcessError(
                f"无法启动 Runtime worker：{self._config.command[0]}：{error}"
            ) from error
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def close(self) -> None:
        process = self._process
        if process is None:
            return
        if process.returncode is None:
            if process.stdin is not None:
                process.stdin.close()
                try:
                    await process.stdin.wait_closed()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            try:
                await asyncio.wait_for(
                    process.wait(), timeout=self._config.shutdown_timeout_seconds
                )
            except TimeoutError:
                process.terminate()
                try:
                    await asyncio.wait_for(
                        process.wait(), timeout=self._config.shutdown_timeout_seconds
                    )
                except TimeoutError:
                    process.kill()
                    await process.wait()
        if self._stderr_task is not None:
            await asyncio.gather(self._stderr_task, return_exceptions=True)
            self._stderr_task = None

    async def request(
        self,
        method: RuntimeMethod,
        payload: Mapping[str, JsonValue],
        *,
        cancelled: CancellationCheck | None = None,
    ) -> dict[str, JsonValue]:
        if cancelled is not None and cancelled():
            raise RuntimeCancelledError("Runtime request 在发送前已取消")
        async with self._request_lock:
            await self.start()
            process = self._require_process()
            request_id = self._create_request_id()
            frame = {
                "schemaVersion": "1.0",
                "requestId": request_id,
                "method": method,
                "payload": dict(payload),
            }
            assert process.stdin is not None
            process.stdin.write((json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8"))
            try:
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as error:
                raise RuntimeProcessError(self._process_exit_message()) from error

            raw_line = await self._read_response_line(cancelled)
            response = self._parse_response(raw_line, request_id)
            if response.get("ok") is not True:
                runtime_error = response.get("error")
                if not isinstance(runtime_error, dict):
                    raise RuntimeProtocolError("Runtime error response 缺少 error object")
                code = runtime_error.get("code")
                message = runtime_error.get("message")
                details = runtime_error.get("details")
                raise RuntimeMethodError(
                    str(code or "RUNTIME_METHOD_FAILED"),
                    str(message or "Runtime method 执行失败"),
                    details if isinstance(details, dict) else None,
                )
            result = response.get("result")
            if not isinstance(result, dict):
                raise RuntimeProtocolError("Runtime success response 缺少 result object")
            return result

    def _require_process(self) -> asyncio.subprocess.Process:
        if self._process is None:
            raise RuntimeProcessError("Runtime worker 尚未启动")
        if self._process.returncode is not None:
            raise RuntimeProcessError(self._process_exit_message())
        return self._process

    async def _read_response_line(self, cancelled: CancellationCheck | None) -> bytes:
        process = self._require_process()
        assert process.stdout is not None
        read_task = asyncio.create_task(process.stdout.readline())
        deadline = asyncio.get_running_loop().time() + self._config.request_timeout_seconds
        try:
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    await self.close()
                    raise RuntimeTimeoutError(
                        f"Runtime request 超过 {self._config.request_timeout_seconds:g} 秒"
                    )
                done, _ = await asyncio.wait((read_task,), timeout=min(0.1, remaining))
                if read_task in done:
                    line = read_task.result()
                    if not line:
                        await self._wait_for_exit_briefly()
                        raise RuntimeProcessError(self._process_exit_message())
                    return line
                if cancelled is not None and cancelled():
                    await self.close()
                    raise RuntimeCancelledError("Runtime request 已取消")
        finally:
            if not read_task.done():
                read_task.cancel()
                await asyncio.gather(read_task, return_exceptions=True)

    async def _wait_for_exit_briefly(self) -> None:
        if self._process is None or self._process.returncode is not None:
            return
        try:
            await asyncio.wait_for(self._process.wait(), timeout=0.2)
        except TimeoutError:
            pass

    def _parse_response(self, raw_line: bytes, request_id: str) -> dict[str, JsonValue]:
        try:
            response: object = json.loads(raw_line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeProtocolError(f"Runtime response 不是合法 JSON：{error}") from error
        if not isinstance(response, dict):
            raise RuntimeProtocolError("Runtime response 必须是 JSON object")
        if response.get("schemaVersion") != "1.0":
            raise RuntimeProtocolError(
                f"不支持的 Runtime response schemaVersion：{response.get('schemaVersion')}"
            )
        if response.get("requestId") != request_id:
            raise RuntimeProtocolError(
                "Runtime response requestId 不匹配："
                f"期望 {request_id}，实际 {response.get('requestId')}"
            )
        return response

    async def _drain_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        while line := await process.stderr.readline():
            self._stderr_lines.append(line.decode("utf-8", errors="replace").rstrip())

    def _process_exit_message(self) -> str:
        return_code = self._process.returncode if self._process is not None else None
        suffix = f"\nstderr:\n{self.stderr_summary}" if self.stderr_summary else ""
        return f"Runtime worker 已退出，exit code={return_code}{suffix}"
