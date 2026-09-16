## Context

Midscene YAML 与原生 aiAct 执行器均在独立 run directory 中运行，并在 Agent 销毁时完成报告写入。Midscene 1.10.0 接受 `reportFileName`，同时通过 Agent 的 `reportFile` 暴露实际输出路径。Python Agent 已能接收结构化 Tool 结果并通过 canonical instructions 控制回复行为。

## Goals / Non-Goals

**Goals:**

- 对三种执行策略采用稳定、可测试的报告文件名。
- 只返回已经完成写入且实际存在的 HTML 文件。
- 让模型通过自然 assistant 内容提供必要的执行说明与产物链接。

**Non-Goals:**

- 不增加报告查询 Tool、通用 artifacts 抽象或 GDEClaw 专用协议。
- 不在 runner 中硬编码工具调用说明。
- 不因报告缺失改变底层电脑操作的成功状态。
- 不处理报告内容脱敏。

## Decisions

### 执行器以 Midscene 实际路径为准

两个执行器向 Midscene 传入固定的 `reportFileName`，在 `destroy()` 完成后读取 `agent.reportFile`。只有该值指向实际存在的文件时，才写入 `reportPath`。这比根据 `MIDSCENE_RUN_DIR` 拼接路径更能兼容 Midscene 的输出格式和后续目录规则。

备选方案是固定拼接 `<runDir>/midscene/report/execution-report.html`。该方案依赖第三方内部目录约定，且不能确认报告是否完成写入，因此不采用。

### `reportPath` 同时存在于执行器结果与 Runtime Tool 结果顶层

执行器结果是持久化事实来源，Runtime bridge 将其中的可选 `reportPath` 提升到 `cua_execute` 顶层，便于模型和 Host 消费，同时保留完整 executor 结果。字段保持可选，以兼容 dry-run、禁用报告和未产出文件的执行。

备选方案是仅在顶层推导路径。该方案会让磁盘结果与 Tool 返回不一致，也无法证明文件已存在，因此不采用。

### 可见说明由模型按照 canonical instructions 生成

instructions 定义何时说明、说明内容边界以及最终回复应包含的 URL/路径。runner 继续原样转发模型生成的 assistant 内容，不注入固定文本，从而保持 Host-neutral 事件协议并避免重复信息。

## Risks / Trade-offs

- [Midscene 在没有可报告执行记录时返回路径但未创建文件] → 销毁后使用文件存在性检查，仅暴露真实文件。
- [第三方未来改变报告路径格式] → 消费 `agent.reportFile`，不依赖手工目录推导。
- [模型过度叙述工具调用] → instructions 明确要求仅在有帮助时说明，并禁止机械复述和隐藏推理。

## Migration Plan

`reportPath` 是可选新增字段，现有 Host 可继续忽略。发布时同步更新 TypeScript 类型、JSON Schema、执行器与 Agent definition；回滚可整体移除新增字段和 prompt 约束，无数据迁移。
