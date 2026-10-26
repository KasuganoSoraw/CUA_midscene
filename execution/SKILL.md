---
name: cua-midscene
description: 维护 CUA 正式 Skill 资产、录制转换和 Midscene Runtime，支持 skillName 绑定执行及自由电脑操作。
---

# CUA Runtime 维护

本文件供开发者和维护型调用方使用，不是 Python Agent 的运行时 prompt，不把内部 Tool 注册给 GDEClaw。GDEClaw Main Agent 选择正式 Skill，并向执行专用 SubAgent 提交完整任务及 skillName 绑定。CUA 默认模型只暴露 cua_execute，不自行选择任务或打开工作台。

## 资产和边界

- 正式 Skill 位于 CUA_SKILLS_ROOT/<skill-name>，SKILL.md name 是规范身份，与目录、cua-manifest.json、0.3 task.json 一致。
- task.yaml 是长期执行流程，task.json 保存目标、输入和来源，source 保存录制证据和参考图。
- 只有完整合法的 CUA 标记资产可由 Runtime 管理。普通宿主 Skill 不进入 CUA 列表、编辑、删除或执行范围。
- 图片只用于语义定位，不能用红叉 crop 替代干净定位参考图，不能越出 Skill 目录。
- 运行产物位于 CUA_DATA_ROOT/runs；CUA_RECORDINGS_ROOT 保存原始录制及处理结果。
- 创建时在独立临时目录组装并生成单 Skill ZIP，通过 GDEClaw 原生导入接口安装、注册和启用；不直接安装到正式根。后续保存直接编辑正式资产，不调用宿主更新接口。
- 宿主负责签名、版本和分发；导入响应及正式资产校验通过不表示已验证全部内部生命周期机制。

## 环境与 CLI

Node.js `>=20.18.1`。源码仓只在仓库根提供 `.env.example`，本机配置放入忽略的 .env.local；组件不携带环境文件。进程环境优先于根 .env.local 和 .env。CUA_SKILLS_ROOT 必须为绝对路径，未配置时 Skill 创建、发现和执行明确失败，freeform 不依赖该根。

Windows `cua_recorder` 是采集 Worker，`cua_record` 后处理器负责轨迹与 Skill 摘要。宿主用 CUA_PYTHON_EXECUTABLE 指定已准备的统一 Python；调用时不安装依赖。

Skill 创建要求 GDECLAW_API_BASE_URL 为宿主实际 API 基础地址；POST /api/gdeclaw/skills/import 使用 enable=true、target_name 查询参数和 multipart file，不发送 X-Agent-Id 或额外 Token。CUA_SKILL_EXPORT_TEMP_ROOT 可配置绝对导出根，缺省系统临时目录，不得位于正式 Skill 根内。ZIP 保留用于排查，超时结果不确定时先核实宿主状态，不直接换名重传。

录制生成和真实执行应设置足够长的超时。模型请求默认 120 秒，Runtime 单请求默认 1800 秒，Review 外层 invocation 默认 40 分钟。

在 execution 根使用编译后的 CLI：

```powershell
node dist/cli/main.js skill list --json
node dist/cli/main.js skill describe --skill-name network-alarm-search
node dist/cli/main.js skill create-from-recording --recording D:\\CUA\\recordings\\Recording_1
node dist/cli/main.js skill validate --skill-name network-alarm-search
node dist/cli/main.js skill run --skill-name network-alarm-search --dry-run
node dist/cli/main.js skill run --skill-name network-alarm-search --strategy replay
```

正式 Skill 创建不需要 scene、task、goal 或人工名称，模型从录制归纳语义元数据。task create-from-recording 与 scene/task 命令仅面向隔离的旧 projects 数据；其 --goal 不参与 trace 生成，不适用于正式 Skill 页面。

## 维护与执行

维护正式流程前读取原始资产及本次运行诊断。提出 `task.yaml` 修改建议，展示原值、新值和原因，等待明确确认；确认后保持输入和证据绑定一致并静态验证，不通过静默跳过掩盖失败。

默认 guided 将完整录制步骤作为自适应执行指导；仅明确要求严格回放时使用 replay；没有 Skill 绑定的完整自然语言目标使用 freeform。不自行搜索替代 Skill，不在失败后切换策略或重试，停止并等待用户明确确认。

成功执行一次后停止 Tool，不为了确认结果继续操作电脑，也不继续读取截图开展业务分析或撰写业务报告。真实电脑操作必须串行。

dry-run 不创建设备或调用模型，不验证页面定位，不得称为模拟执行。实际执行返回可用 reportPath 和结构化截图、诊断，不能编造报告位置。

## Workbench 宿主入口

Workbench 由 GDEClaw 设置按钮调用 Keeper 持有的 Runtime workbench 方法启动，返回 URL 和 reused。不要在对话式 Agent 工具或任务完成流程中启动工作台。宿主负责打开页面并保持 worker 存活。

开发者在明确需要维护界面时可使用 node dist/cli/main.js review --no-open；这不是模型 Tool。服务身份同时绑定数据根和 Skill 根。

详细目录、Schema、安全、请求示例及迁移说明见 ../docs/gdeclaw-skill-integration.md；发布包中的基础说明见 references/task-contract.md。
