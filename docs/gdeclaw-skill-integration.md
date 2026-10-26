# CUA Skill 资产与 GDEClaw 宿主集成

## 职责

GDEClaw Main Agent 使用原生 Skill 机制选择任务，提交完整电脑操作目标及明确的 Skill 绑定。CUA SubAgent 只执行指定任务，不重新发现 Skill，不继续业务分析、数据提取或报告撰写。Workbench 用于人工录制、生成、复核和调试，由设置按钮通过 Keeper 启动。

CUA 在独立临时目录生成并校验单个 Skill ZIP，通过 GDEClaw 原生 HTTP 导入接口安装、注册和启用。Workbench 后续直接读取、编辑和执行正式 Skill，不提供发布或同步按钮，不依赖宿主更新 API。CUA 不实现宿主内部的安装、注册、启用、签名、版本管理或 SkillHub。

## 配置与版本

```dotenv
CUA_SKILLS_ROOT=D:\GDEClaw\skills
CUA_DATA_ROOT=D:\CUA\data
CUA_RECORDINGS_ROOT=D:\CUA\recordings
CUA_AGENT_TOOL_MODE=execute
CUA_AGENT_FREEFORM_ONLY=false
# 由宿主注入实际运行时 API 地址，端口不固定：
GDECLAW_API_BASE_URL=http://127.0.0.1:<实际端口>
# 可选；未配置使用系统临时目录：
CUA_SKILL_EXPORT_TEMP_ROOT=D:\CUA\skill-exports
```

CUA_SKILLS_ROOT 必须是绝对路径。统一 RuntimeLayout 按进程环境、仓库根 .env.local、仓库根 .env 解析；进程显式空值表示未配置。宿主应在启动 Runtime worker 时注入环境，Python CLI 不自行查找环境文件。路径不暴露给模型。

- Skill 创建、发现与绑定执行需要 CUA_SKILLS_ROOT，未配置明确报错，不回退到 projects。
- 自由目标 freeform 不需要 Skill 根；运行报告仍需要 CUA_DATA_ROOT。
- CUA_DATA_ROOT 保存 runs、缓存及隔离的旧版兼容数据，不存放新正式任务。
- CUA_RECORDINGS_ROOT 保存原始录制及其处理产物；正式 Skill 的 source 保存所需证据副本，不复制原始视频。
- GDECLAW_API_BASE_URL 用于创建时的原生导入；缺失时在调用录制模型前失败，不阻止 Workbench 启动或已有任务执行。默认 workspace 不发送 X-Agent-Id，不增加 Token 或鉴权机制。
- CUA_SKILL_EXPORT_TEMP_ROOT 采用相同配置优先级，必须是可读写绝对目录；未配置使用系统临时目录。导出目录不可位于正式 Skill 根内，真实路径校验会识别链接别名。

Skill 资产契约版本为 1.0，Manifest schemaVersion=0.1，task.json schemaVersion=0.3。JSONL envelope 保持 1.0；此 envelope 版本不表示旧组件支持 skillName。宿主必须整体升级 Python Agent 与 TypeScript Runtime，使用导出 skillAssetContractVersion=1.0 的组件，不能混搭旧 scene/task Agent。Review identity protocolVersion=4 并包含 skillsRootKey；旧页面链接需要重新打开。

## 正式目录

```text
<CUA_SKILLS_ROOT>/
└── network-alarm-search/
    ├── SKILL.md
    ├── cua-manifest.json
    ├── task.json
    ├── task.yaml
    └── source/
        ├── showui-trace.json
        ├── processed-log.json
        ├── processed-log-sc.json
        ├── screenshots/
        └── reference-images/
```

SKILL.md frontmatter 是规范身份与描述的来源：

```yaml
---
name: network-alarm-search
description: 查询网络告警。由 CUA 子 Agent 执行此电脑操作任务。
---
```

名称使用至多 64 字符的小写英文、数字和连字符，不接受目录路径或 Windows 保留名称。目录名必须与 frontmatter name 完全一致。

```json
{
  "schemaVersion":"0.1",
  "kind":"cua-skill",
  "skillName":"network-alarm-search",
  "taskSchemaVersion":"0.3"
}
```

task.json 使用 skillName、title、description、goal、source 和 inputs，不包含 scene/task。skillName 与 title 等于规范 name；description 与 SKILL.md 一致。task.yaml 的 agent.groupName 等于 skillName，groupDescription 等于 goal。步骤和参数仍使用 step-NNN 与 step-NNN-input。

录制处理复用现有 TraceGenerator 模型客户端，根据完整轨迹生成 name/description/goal；步骤仍由 operation 确定性转换。模型摘要无效时创建失败。打包前扫描正式根下所有实际目录名及已有 SKILL.md 的规范 name，包括未标记的普通宿主 Skill；仅名称占用检查读取这些元数据，不把普通 Skill 纳入工作台管理。

名称优先使用模型原值。已占用时追加安全随机生成的六位十六进制后缀，并截断主名称以满足 64 字符限制。名称在组装前统一确定，所有身份字段及 YAML groupName 保持一致；description、goal、步骤与录制证据不变，不重复调用模型。导入接口随后返回 409 时停止，不覆盖、不自动换名重传。

## 安全与写入

每次读取、编辑、删除、上传和执行都验证 CUA Manifest、任务 Schema、SKILL.md、YAML、输入与文件引用。普通 Skill 没有合法 CUA 标记时被忽略；损坏或身份不一致的 CUA 目录仅展示不可操作的诊断。

目录边界使用规范化路径、realpath 与逐级链接检查。Skill 内不接受符号链接资产、绝对图片路径、网络图片引用、Windows 盘符或 ../。模型不能指定 skillsRoot、skillRoot、dataRoot 或任意文件路径。

每次创建在导出根下使用独立的 cua-skill-export-* 临时任务目录。组装和 ZIP 打包失败仅清理本次拥有的目录，不触碰正式 Skill 或原始录制。ZIP 以排他写入保存；ZIP 生成后不自动删除，成功和导入失败均可保留用于排查。正式安装及冲突仲裁由 GDEClaw 原生接口负责，不实现安装数据库或复杂并发协调。

保存使用排他写锁、四个身份/流程文件的 revision、重新读取校验与双文件失败回滚。参考图使用内容哈希和不可变存储，绑定与步骤一起保存。浏览器草稿不是正式资产；冲突时保留草稿并要求重新加载。写锁异常退出可能留下 .cua-locks 中的锁文件，维护者应确认没有运行中的写入后清理对应锁文件。

本地 Manifest 是资产类型/版本声明，不是密码学签名或权限证明。拥有 Skill 根写权限的进程属于宿主信任边界；CUA 不替代宿主目录权限、签名与生命周期校验，也不保证对抗恶意进程持续替换目录的文件系统竞态。

## 原生 Skill 导入

单 Skill ZIP 使用 fflate 生成，文件直接位于归档根，不包含临时任务目录或 Skill 名称外层：

```text
<skill-name>.zip
├── SKILL.md
├── cua-manifest.json
├── task.json
├── task.yaml
└── source/
    ├── showui-trace.json
    ├── processed-log.json
    ├── processed-log-sc.json
    └── ...
```

归档布局由独立打包函数维护，并由测试检查完整性；真实 GDEClaw 导入器仍需联调核对这一布局。

```typescript
const baseUrl = process.env.GDECLAW_API_BASE_URL?.trim();
if (!baseUrl) throw new Error('缺少 GDECLAW_API_BASE_URL');
const url = new URL('/api/gdeclaw/skills/import', baseUrl);
url.searchParams.set('enable', 'true');
url.searchParams.set('target_name', skillName);
const form = new FormData();
form.append('file', new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' }), `${skillName}.zip`);
const response = await fetch(url, { method: 'POST', body: form });
```

enable 与 target_name 是查询参数，multipart 只包含 file，不发送 rename_map、X-Agent-Id 或 Token。Content-Type 及 boundary 由 fetch 自动生成。基础地址来自可信配置，不硬编码端口；请求禁止重定向，超时为 60 秒，不自动重试。

HTTP 400、409、500 等失败状态保留上游诊断及 ZIP 路径。2xx 响应必须是合法 JSON 对象且不能显式报告失败；随后还必须从 CUA_SKILLS_ROOT 通过 readSkill 重新校验刚导入的身份和全部资产。仅收到成功响应但目录不可发现时返回配置或资产错误，不能报告完整成功。

网络中断、超时或成功响应无法解析时，导入结果可能不确定。应先核实 GDEClaw 中是否已经安装，不要直接换名重传。CUA 不删除可能已经由宿主安装的 Skill。

创建结果包含 created、valid、skillName、goal、zipPath。Workbench 只有在导入及正式资产复核均成功后才刷新并打开新任务。ZIP 路径是诊断产物，不是新的正式目录。

## 宿主 Workbench 调用

Keeper 保持 Runtime worker 存活，直接发送 JSONL，不需要 Agent 模型：

```json
{"schemaVersion":"1.0","requestId":"settings-1","method":"workbench","payload":{"mode":"review","skillName":"network-alarm-search"}}
```

返回 result 包含 mode、baseUrl、url、reused。mode 可为 recording、review、execution；目标使用 skillName。CUA 不默认打开浏览器，由 GDEClaw 前端打开 url。服务复用同时核对数据根、规范化 Skill 根和开发模式；不同根占用同一端口时明确失败，不错误复用。

Python 宿主可使用已有 JsonlRuntimeClient.request("workbench", payload)，Node 宿主可使用 cuaWorkbench()。默认端口为 loopback 47831。启动请求返回后不能立即结束持有服务的 worker。

## 执行绑定

```json
{
  "task":"执行已选定的告警查询，查询指定设备",
  "invocationId":"run-1",
  "execution":{
    "skillName":"network-alarm-search",
    "inputs":{"step-003-input":"device-1"}
  }
}
```

省略 strategy 归一化为 guided；明确严格回放时传 replay。执行专用模型只获得 cua_execute，必须与绑定身份、策略、输入完全一致。Runtime 从可信根解析实际 Skill 并验证输入；不存在、非法或普通宿主 Skill 直接失败，不寻找替代任务。无参数任务可省略 inputs，使用已保存默认值时仍由调用方确认其适用性。

```json
{"task":"打开系统并导出本月销售报表","invocationId":"run-2"}
```

没有 execution 的完整自然语言任务直接绑定 freeform，不搜索 Skill，不要求选择策略。成功执行后停止 Tool，剩余调用不会执行。失败不自动重试或切换策略，报告路径原样反馈，截图及其他运行路径保留在结构化结果中。

## Workbench 与 CLI

- GET /api/skills：配置状态、平铺 Skill 列表和不可操作的资产诊断。
- GET/PUT/DELETE /api/skills/:skillName：读取、revision 保护保存、删除。
- POST /api/skills/:skillName/mutate、/validate：结构编辑与资产校验。
- POST /api/skills/:skillName/reference-images?revision=...：二进制图片上传。
- GET /api/skills/:skillName/evidence?path=source/...：安全图片读取。
- POST /api/recordings/:recording/skills，body={}：异步生成；GET /api/skill-generation 查询状态。
- POST /api/execution/start：skillName、inputs、可选 mode（act 为 guided，task 为 replay），默认 act。

```powershell
cd execution
npm.cmd run cua -- review --no-open
npm.cmd run cua -- skill list --json
npm.cmd run cua -- skill create-from-recording --recording D:\CUA\recordings\Recording_1
npm.cmd run cua -- skill validate --skill-name network-alarm-search
npm.cmd run cua -- skill run --skill-name network-alarm-search --dry-run
npm.cmd run cua -- skill run --skill-name network-alarm-search --strategy replay
```

移除 dry-run 会产生真实桌面副作用。宿主须串行协调电脑操作。

## 迁移与兼容

旧资产位于 CUA_DATA_ROOT/projects/<scene>/<task>，使用 0.2 task.json 和 scene/task。显式 scene/task CLI、独立 discover 配置与兼容接口仍针对这套目录，不能把它们当作新的 GDEClaw 工作流。新 Workbench 不读取这些目录，不提供场景选择或发布流程。

没有自动移动旧资产。可使用保留的原始录制生成完整 Skill，人工复核后使用规范 skillName；不要只复制旧 task.json 或添加空 Manifest 来冒充合法 Skill。原任务及运行历史不删除。宿主结构化请求必须改用 skillName；Python execution 绑定拒绝旧 scene/task，避免字段被忽略。CLI 兼容入口不会扫描正式 Skill 根。

## 验证边界

自动化覆盖目录安全、普通 Skill 名称占用、随机后缀身份一致性、临时导出、ZIP 布局、multipart 请求、导入失败与超时、正式目录复核、录制摘要、正式保存、图片引用、平铺页面、生成导航、服务隔离、绑定校验、guided/replay/freeform、执行终态与报告。HTTP 导入使用 mock fetch，模型和录制使用隔离夹具，dry-run 不操作真实业务桌面。

GDEClaw 宿主需注入实际 GDECLAW_API_BASE_URL 与 default workspace 对应的 CUA_SKILLS_ROOT，并保证导入接口和 Runtime 访问同一正式目录。Keeper 保持 worker 存活，设置按钮打开返回 URL，Main Agent 选定 Skill 后构造 execution。原生导入器的解包、注册、启用、签名及分发行为由内部仓库维护；mock 请求通过不表示这些宿主流程已经完成真实联调。
