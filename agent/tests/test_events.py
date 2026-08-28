from cua_agent import AgentEvent


def test_agent_event_serializes_with_stable_schema() -> None:
    event = AgentEvent(
        invocation_id="inv-1",
        type="progress",
        message="正在查找 Recorded Skill",
        data={"phase": "catalog"},
        timestamp="2026-08-28T00:00:00+00:00",
    )

    assert event.to_dict() == {
        "schemaVersion": "1.0",
        "invocationId": "inv-1",
        "type": "progress",
        "timestamp": "2026-08-28T00:00:00+00:00",
        "message": "正在查找 Recorded Skill",
        "data": {"phase": "catalog"},
    }
