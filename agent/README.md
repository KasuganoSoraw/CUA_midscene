# CUA Agent

`cua-agent` 是面向 GDEClaw 和本地开发调试的专门 Computer-Use Subagent。

它每次接收一个完整任务，在单次调用内负责模型 Tool Calling 和任务级执行策略选择；它不保存跨调用 Session、长期记忆或用户聊天历史。实际 catalog、replay、guided、freeform、workbench 和 Midscene 执行仍由 TypeScript `execution` Runtime 提供。

当前目录是独立 Python 包边界。依赖由安装或部署阶段准备，运行阶段不会执行 `uv sync`、`pip install`、`npm install` 或 lock 操作。

