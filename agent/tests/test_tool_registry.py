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


def test_registry_exposes_only_skill_and_freeform_execution() -> None:
    async def scenario() -> None:
        client = FakeRuntimeClient()
        registry = create_cua_tool_registry(
            client, data_root="C:/cua-data",  # type: ignore[arg-type]
        )

        assert [tool.name for tool in registry.definitions] == ["cua_execute"]
        execute = registry.definitions[0]
        assert execute.input_schema["type"] == "object"
        branches = execute.input_schema["oneOf"]
        for branch in branches[:2]:  # type: ignore[index]
            assert set(branch["properties"]) == {"strategy", "skillName", "inputs"}
            assert branch["required"] == ["strategy", "skillName"]
        await registry.call(
            "cua_execute",
            {"strategy": "freeform", "goal": "打开 Chrome"},
        )
        for tool in ("cua_catalog", "cua_workbench"):
            with pytest.raises(ValueError, match="无法识别"):
                await registry.call(tool, {})
        assert client.calls == [("execute", {
            "strategy": "freeform", "goal": "打开 Chrome", "dataRoot": "C:/cua-data",
        })]

    asyncio.run(scenario())


def test_freeform_only_registry_exposes_one_tool_without_changing_full_schema() -> None:
    client = FakeRuntimeClient()
    registry = create_cua_tool_registry(client, freeform_only=True)  # type: ignore[arg-type]
    assert [tool.name for tool in registry.definitions] == ["cua_execute"]
    schema = registry.definitions[0].input_schema
    assert "oneOf" not in schema
    assert schema["required"] == ["strategy", "goal"]
    assert schema["additionalProperties"] is False
    assert set(schema["properties"]) == {"strategy", "goal", "displayId"}  # type: ignore[arg-type]
    full = create_cua_tool_registry(client)  # type: ignore[arg-type]
    assert len(full.definitions) == 1
    assert len(full.definitions[0].input_schema["oneOf"]) == 3  # type: ignore[arg-type]


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
    ("cua_catalog", {"action": "list-scenes"}),
    ("cua_workbench", {"mode": "recording"}),
    ("cua_execute", {"strategy": "replay", "scene": "s", "task": "t"}),
    ("cua_execute", {"strategy": "guided", "scene": "s", "task": "t"}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "inputs": {}}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "scene": "s"}),
    ("cua_execute", {"goal": "打开 Chrome"}),
    ("cua_execute", {"strategy": "freeform", "goal": " "}),
    ("cua_execute", {"strategy": "freeform", "goal": "打开 Chrome", "displayId": 1}),
])
def test_freeform_only_registry_rejects_calls_before_runtime(
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
                "skillName": "nce-qos",
                "inputs": '{"step-006-input":"50.0.188.54:31943","step-009-input":"admin"}',
            },
        )

        assert client.calls == [
            (
                "execute",
                {
                    "strategy": "replay",
                    "skillName": "nce-qos",
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
                    "skillName": "nce-qos",
                    "inputs": "not-json",
                },
            )
        with pytest.raises(ValueError, match="键和值必须都是字符串"):
            await registry.call(
                "cua_execute",
                {
                    "strategy": "guided",
                    "skillName": "nce-qos",
                    "inputs": '{"step-006-input":31943}',
                },
            )
        assert len(client.calls) == 1

    asyncio.run(scenario())
