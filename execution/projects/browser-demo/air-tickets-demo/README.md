# air-tickets-demo

这是 `browser-demo` 场景中的 Qatar Airways 航班搜索任务。

- `task.yaml`：任务维护者、Review、TypeScript Runtime 与 Midscene 共同消费的唯一长期执行流程；Python Agent 不直接读取文件。
- `task.json`：任务说明、trace 来源、输入 ID 和录制默认值。
- `SKILL.md`：CLI 使用者和任务维护者的调用与长期修改规则，不是 Python Agent 的运行时 prompt。
- `source/`：本任务的 trace、处理日志和截图证据。

本目录是 Skill 内只读 builtin 任务。用户任务存放在 `<CUA_DATA_ROOT>/projects`，运行快照、执行结果、Midscene 报告和截图存放在 `<CUA_DATA_ROOT>/runs/<run-id>`。
