from __future__ import annotations

import asyncio
from collections.abc import Mapping

import pytest

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


def test_shared_registry_exposes_catalog_execute_record_without_workbench() -> None:
    async def scenario() -> None:
        client = FakeRuntimeClient()
        registry = create_cua_tool_registry(client, data_root="C:/cua-data")  # type: ignore[arg-type]

        assert [tool.name for tool in registry.definitions] == [
            "cua_catalog",
            "cua_execute",
            "cua_record",
        ]
        assert all(tool.input_schema["type"] == "object" for tool in registry.definitions)
        catalog, execute, record = registry.definitions
        catalog_actions = {
            branch["properties"]["action"]["const"]: branch  # type: ignore[index]
            for branch in catalog.input_schema["oneOf"]  # type: ignore[union-attr]
        }
        assert set(catalog_actions) == {
            "list-scenes",
            "list-tasks",
            "find-task",
            "describe-task",
        }
        assert "明确提供 task 标识但未提供 scene" in catalog.description
        find_action = catalog_actions["find-task"]["properties"]["action"]  # type: ignore[index]
        assert "跨场景精确查找" in find_action["description"]  # type: ignore[index]
        assert "不向调用方请求策略确认" in catalog.description
        assert "完整操作流程或纯业务目标直接 freeform，不主动检索" in catalog.description
        assert record.input_schema["required"] == ["goal"]
        assert "真实桌面副作用" in execute.description
        assert "成功后不得再次" in execute.description
        freeform_schema = execute.input_schema["oneOf"][2]["properties"]["strategy"]  # type: ignore[index]
        assert "不需要调用方再次确认" in freeform_schema["description"]  # type: ignore[index]

        await registry.call("cua_catalog", {"action": "list-scenes"})
        await registry.call(
            "cua_execute",
            {"strategy": "freeform", "goal": "打开 Chrome", "dataRoot": "D:/override"},
        )
        with pytest.raises(ValueError):
            await registry.call("cua_workbench", {"mode": "recording"})

        assert client.calls == [
            ("catalog", {"action": "list-scenes", "dataRoot": "C:/cua-data"}),
            (
                "execute",
                {"strategy": "freeform", "goal": "打开 Chrome", "dataRoot": "D:/override"},
            ),
        ]

    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["normal", "professional"])
def test_compatibility_modes_expose_the_same_tools_and_execution_schema(mode) -> None:
    client = FakeRuntimeClient()
    registry = create_cua_tool_registry(client, tool_mode=mode)  # type: ignore[arg-type]
    assert [tool.name for tool in registry.definitions] == [
        "cua_catalog", "cua_execute", "cua_record",
    ]
    assert len(registry.definitions[1].input_schema["oneOf"]) == 3  # type: ignore[arg-type]
    assert registry.definitions == create_cua_tool_registry(
        client, freeform_only=True,  # type: ignore[arg-type]
    ).definitions


def test_freeform_only_registry_executes_goal_with_data_root_and_display() -> None:
    async def scenario() -> None:
        client = FakeRuntimeClient()
        registry = create_cua_tool_registry(
            client, data_root="C:/cua-data", freeform_only=True,  # type: ignore[arg-type]
        )
        await registry.call(
            "cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "displayId": "1"},
        )
        assert client.calls == [("execute", {
            "strategy": "freeform", "goal": "打开 Chrome", "displayId": "1",
            "dataRoot": "C:/cua-data",
        })]

    asyncio.run(scenario())


@pytest.mark.parametrize(("name", "arguments"), [
    ("cua_workbench", {"mode": "recording"}),
    ("cua_record", {"goal": " "}),
    ("cua_record", {"goal": "录制", "scene": "s"}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "inputs": {}}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "scene": "s"}),
    ("cua_execute", {"goal": "打开 Chrome"}),
    ("cua_execute", {"strategy": "freeform", "goal": " "}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "displayId": 1}),
])
def test_shared_registry_rejects_unsupported_calls_before_runtime(
    name: str, arguments: dict[str, JsonValue],
) -> None:
    client = FakeRuntimeClient()
    registry = create_cua_tool_registry(client, freeform_only=True)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        asyncio.run(registry.call(name, arguments))
    assert client.calls == []


def test_registry_normalizes_double_encoded_inputs_and_rejects_invalid_values() -> None:
    async def scenario() -> None:
        client = FakeRuntimeClient()
        registry = create_cua_tool_registry(client)  # type: ignore[arg-type]

        await registry.call(
            "cua_execute",
            {
                "strategy": "replay",
                "scene": "nce-test",
                "task": "nce-qos",
                "inputs": '{"step-006-input":"50.0.188.54:31943","step-009-input":"admin"}',
            },
        )

        assert client.calls == [
            (
                "execute",
                {
                    "strategy": "replay",
                    "scene": "nce-test",
                    "task": "nce-qos",
                    "inputs": {
                        "step-006-input": "50.0.188.54:31943",
                        "step-009-input": "admin",
                    },
                },
            )
        ]

        with pytest.raises(ValueError, match="必须是 JSON object"):
            await registry.call(
                "cua_execute",
                {
                    "strategy": "replay",
                    "scene": "nce-test",
                    "task": "nce-qos",
                    "inputs": "not-json",
                },
            )
        with pytest.raises(ValueError, match="键和值必须都是字符串"):
            await registry.call(
                "cua_execute",
                {
                    "strategy": "guided",
                    "scene": "nce-test",
                    "task": "nce-qos",
                    "inputs": '{"step-006-input":31943}',
                },
            )
        assert len(client.calls) == 1

    asyncio.run(scenario())
