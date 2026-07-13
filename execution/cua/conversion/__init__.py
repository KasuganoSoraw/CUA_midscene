"""record trace 到执行 IR 的转换能力。"""

from .input_locate import derive_input_locate_prompt
from .showui_trace import convert_trace

__all__ = ["convert_trace", "derive_input_locate_prompt"]
