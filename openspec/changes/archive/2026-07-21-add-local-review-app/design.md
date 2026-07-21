## Context

当前 `execution/` 是可独立发布的 TypeScript Skill 包，`cua/` 同时承载 trace 转换、catalog、任务契约、输入解析和执行。用户任务位于 `<CUA_DATA_ROOT>/projects/`，内置任务位于包内只读 `projects/`。GDE Claw 可稳定调用系统浏览器打开 URL，但不适合要求用户部署远程服务；Agent 仍应能够直接修改 canonical YAML。

复核页面需要组合 `task.yaml`、`task.json` 和 `source/`，并执行只属于人类复核体验的截图、草稿、diff、revision 与保存逻辑。这些职责不应进入 trace converter 或执行主链路。

## Goals / Non-Goals

**Goals:**

- 在 `execution/review/` 建立与 `cua/` 平级的本地复核应用。
- 使用 Vue 3、TypeScript 和 Vite 实现浏览器界面。
- 由随包发布的 Node.js localhost 服务安全访问 CUA catalog 和用户任务。
- 复用 CUA 解析与校验，支持步骤内容与结构编辑、证据展示、语义 diff 和冲突检测。
- 保持 `task.yaml` 为唯一长期执行流程，且不新增持久化 JSON 文件。
- 保持 Agent 直接编辑资产并运行 `task validate` 的路径。

**Non-Goals:**

- 不提供远程托管、多用户协作、账号、数据库或云同步。
- 不增加步骤编辑 CLI，也不要求 Agent 经由 review service 修改文件。
- 不修改 `source/`，不为人工步骤伪造录制证据。
- 不在第一版执行 computer use；页面仅复核与保存任务资产。

## Decisions

### 1. `review/` 与 `cua/` 平级

`cua/` 保持无界面核心，`review/` 是消费 CUA API 的本地应用。依赖方向为 `review/service -> cua`，`cua`、converter 与 executor 不得反向依赖 review。

备选方案是 `cua/review/`，但这会暗示复核属于执行核心并让前端 DTO、HTTP 和 revision 概念渗入核心命名空间，因此不采用。

### 2. review 分成 shared、service、server、web

- `shared/` 只包含可在 Node 与浏览器编译的 DTO。
- `service/` 组合任务资产、构造证据、应用结构修改、生成 diff、校验 revision 并保存。
- `server/` 使用 Node.js 内置 HTTP 服务承载 API 和静态资源，只监听 `127.0.0.1`。
- `web/` 使用 Vue 3 + TypeScript + Vite，不直接访问文件系统。

HTTP route 不得自行修改 YAML；它只解析请求并调用 service。

### 3. 顶层 CLI 作为统一分发入口

将产品命令入口逐步提升到 `execution/cli/`，保持现有 `cua` bin 和子命令兼容。新增 `cua review` 只负责启动本地服务与返回/打开 URL，不提供 insert/delete/move 命令。

### 4. 结构编辑继续使用 `step-NNN`

步骤编号代表当前执行顺序。插入、删除或移动后，service 对整个数组重新编号，并结构化迁移 YAML 占位符和 `task.json.inputs`。前端 diff 将机械重编号折叠为结构编辑摘要，避免淹没真实变更。

不同的 `manual-*` 名称会造成两套用户心智模型，因此不采用。

### 5. 证据绑定保存在现有 task manifest

在 `task.json.source` 增加可选 `stepBindings: Record<string, number | null>`。值为原始 trace step ID，人工步骤为 `null`。截图路径继续来自 processed log，绑定不得复制文件路径。

既有任务缺少绑定时，review service 可在 trace/processed log 长度与初始 YAML 一致时生成内存绑定；首次结构保存会写入显式绑定。该字段向后兼容，不新增 sidecar 文件。

### 6. revision 与原子联合保存

revision 由 canonical `task.json` 和 `task.yaml` 原始字节共同计算。保存请求必须携带 expected revision；不一致时返回冲突。保存前对两份草稿执行 JSON Schema、CUA recorded task 和 Midscene parser 校验。

需要修改两份文件时，service 先写同目录临时文件并完成校验，再依次原子替换；若第二次替换失败则使用已读取的原始内容回滚第一份。Windows 上使用同卷 rename，且临时文件名包含随机后缀。

### 7. 本地访问边界

服务只绑定 `127.0.0.1` 并默认由操作系统分配随机端口，第一版不生成访问 token。API 只接受已校验的 scene/task 标识，并通过 catalog resolver 获取 task root；证据路径必须解析后仍位于该任务 `source/`。builtin task 永远只读。

### 8. 步骤编辑使用临时语义模型

前端从当前步骤的标准 Midscene action 解析出只存在于浏览器内存中的语义字段，例如等待时间、目标描述、输入值、按键和等待条件。普通表单修改这些字段时，前端立即重新生成 Flow 以及对应的 `task.json.inputs` 预览，并将合法结果更新到 review 草稿；磁盘仍只在用户点击确认后写入 canonical `task.yaml` 与 `task.json`，不新增持久化中间文件。

“高级”区域默认只读展示实时生成的 Flow JSON 与当前步骤参数定义。用户显式启用高级编辑后，页面使用独立文本缓冲区，只有在 JSON 解析和步骤契约校验成功并点击应用后才反向更新语义表单与草稿。无法识别为标准动作模板的自定义 Flow 保留原始内容，并提示用户使用高级模式，避免无损转换失败时静默覆盖。

## Risks / Trade-offs

- [双文件原子性无法达到数据库事务级别] → 使用同目录临时文件、备份原始字节、失败回滚，并通过测试覆盖第二次替换失败。
- [Agent 在页面打开期间直接修改文件] → revision 冲突阻止页面覆盖，前端提示重新加载。
- [既有任务没有 stepBindings] → 只在可证明 trace 与步骤一一对应时建立 fallback；不明确时显示无证据而不猜测。
- [Vue 构建与 Node tsc 共用 dist] → Vite 固定输出到 `dist/review/web` 且不得清空整个 `dist`，构建统一先 clean、再 tsc、最后 Vite。
- [结构编辑导致大型文本 diff] → 页面展示语义 diff，同时保留最终 YAML 预览用于复核。
- [无 token 的本地服务可被同机进程探测] → 第一版依赖 loopback、随机端口和短生命周期进程降低暴露面；若后续引入远程访问或常驻服务，再增加鉴权机制。

## Migration Plan

1. 扩展 task schema/types/converter 支持可选 stepBindings，并保持旧任务可读。
2. 增加 review shared/service/server 及其测试。
3. 增加 Vue web 与构建配置。
4. 增加顶层 CLI 分发和 `cua review`，保持现有命令兼容。
5. 更新 Skill、README、发布文件和测试。
6. 通过 `npm test`、review web build、CLI 冒烟和 OpenSpec validate 后发布。

回滚时可移除 review 构建与命令；可选 stepBindings 不影响旧版执行器读取前提是回滚版本仍允许该字段。若需完全回滚，应同时移除已写入任务 manifest 的 stepBindings。

## Open Questions

- 第一版 `cua review` 是否自动调用系统浏览器，还是仅输出 URL 由 GDE Claw 打开；实现时优先同时支持 `--no-open` 以便测试。
- 页面关闭后服务何时退出；第一版可由进程生命周期控制，并预留空闲超时而不强制实现。
