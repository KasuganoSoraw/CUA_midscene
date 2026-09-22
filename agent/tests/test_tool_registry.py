from __future__ import annotations

import asyncio
from collections.abc import Mapping

from cua_agent.contracts import JsonValue
from cua_agent.tools import create_cua_tool_registry


class FakeRuntimeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []

    async def request(
        self,
        method: str,
        payload: Mapping[str, JsonValue],
        *,
        cancelled: object | None = None,
    ) -> dict[str, JsonValue]:
        self.calls.append((method, dict(payload)))
        return {"ok": True, "method": method}


def test_registry_keeps_three_tools_private_and_maps_runtime_methods() -> None:
    async def scenario() -> None:
        client = FakeRuntimeClient()
        registry = create_cua_tool_registry(client, data_root="C:/cua-data")  # type: ignore[arg-type]

        assert [tool.name for tool in registry.definitions] == [
            "cua_catalog",
            "cua_execute",
            "cua_workbench",
        ]
        assert all(tool.input_schema["type"] == "object" for tool in registry.definitions)
        catalog, execute, workbench = registry.definitions
        assert "不向调用方请求策略确认" in catalog.description
        assert "真实桌面副作用" in execute.description
        assert "成功后不得再次" in execute.description
        freeform_schema = execute.input_schema["oneOf"][2]["properties"]["strategy"]  # type: ignore[index]
        assert "不需要调用方再次确认" in freeform_schema["description"]  # type: ignore[index]
        assert "不是 cua_execute 的结果查看页面" in workbench.description
        mode_schema = workbench.input_schema["properties"]["mode"]  # type: ignore[index]
        assert "不表示查看 freeform" in mode_schema["description"]  # type: ignore[index]

        await registry.call("cua_catalog", {"action": "list-scenes"})
        await registry.call(
            "cua_execute",
            {"strategy": "freeform", "goal": "打开 Chrome", "dataRoot": "D:/override"},
        )
        await registry.call("cua_workbench", {"mode": "recording"})

        assert client.calls == [
            ("catalog", {"action": "list-scenes", "dataRoot": "C:/cua-data"}),
            (
                "execute",
                {"strategy": "freeform", "goal": "打开 Chrome", "dataRoot": "D:/override"},
            ),
            ("workbench", {"mode": "recording", "dataRoot": "C:/cua-data"}),
        ]

    asyncio.run(scenario())
