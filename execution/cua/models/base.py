from __future__ import annotations

from pydantic import BaseModel, ConfigDict


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        populate_by_name=True,
        strict=True,
    )

    def to_json_dict(self, *, exclude_none: bool = True) -> dict[str, object]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=exclude_none)
