## ADDED Requirements

### Requirement: 本地复核应用随执行器发布
系统 SHALL 将复核应用的 Node.js 服务端与 Vue 3 前端构建产物随 `cua-midscene` 包发布，并通过统一命令启动仅监听 loopback 的临时本地服务。

#### Scenario: 启动复核控制台
- **WHEN** 用户调用 `cua review` 并具有有效的 `CUA_DATA_ROOT`
- **THEN** 系统 SHALL 在 `127.0.0.1` 上使用系统分配的随机可用端口启动服务
- **AND** 系统 SHALL 提供不含访问 token、可由系统浏览器打开的本地 URL

#### Scenario: 发布环境离线使用
- **WHEN** 目标机器无法访问远程服务器
- **THEN** 复核页面 SHALL 仍可从包内静态资源加载并读写本地 user catalog
- **AND** 系统 SHALL NOT 要求数据库或远程 API

### Requirement: 复核应用组合现有任务资产
复核服务 SHALL 从 CUA catalog API 发现 builtin 与 user 场景和任务，并将 `task.yaml`、`task.json` 与只读 `source/` 组合成供前端消费的复核视图，而不得创建第二份长期执行流程。

#### Scenario: 查看录制任务
- **WHEN** 用户在页面选择一个合法任务
- **THEN** 页面 SHALL 展示任务步骤、输入定义、origin、writable、全局截图和局部截图
- **AND** 步骤内容 SHALL 来源于 canonical `task.yaml`

#### Scenario: 查看内置任务
- **WHEN** 用户选择 builtin catalog 中的任务
- **THEN** 页面 SHALL 允许查看任务和证据
- **AND** 页面 SHALL 禁用保存并明确展示只读状态

### Requirement: 保存必须校验版本与任务契约
复核服务 SHALL 使用 `task.json` 与 `task.yaml` 内容计算 revision，并只在客户端 revision 仍为当前版本时联合校验和原子保存 user task。

#### Scenario: 保存合法草稿
- **WHEN** 用户确认合法变更且任务仍保持原 revision
- **THEN** 系统 SHALL 使用 CUA 与 Midscene 校验器验证草稿
- **AND** 系统 SHALL 原子替换所有需要修改的 canonical 资产并返回新 revision

#### Scenario: Agent 已在外部修改任务
- **WHEN** 页面保存时磁盘 revision 与页面打开时不同
- **THEN** 系统 SHALL 拒绝覆盖并返回冲突
- **AND** 页面 SHALL 要求用户重新载入或重新应用草稿

### Requirement: 本地文件访问限制在任务边界内
复核服务 SHALL 仅允许通过 scene/task 标识访问已解析 catalog 中的任务及其 source 文件，不得暴露任意文件路径读取或写入接口。

#### Scenario: 请求越界证据路径
- **WHEN** 请求包含绝对路径、父目录跳转或解析后越出目标任务 source 目录
- **THEN** 服务 SHALL 拒绝请求且不得读取该文件

### Requirement: 步骤内容通过语义表单编辑
页面 SHALL 将标准 Midscene 步骤解析为与动作类型对应的语义字段，并由这些字段实时生成 Flow 和当前步骤参数定义；页面 SHALL NOT 要求普通用户直接编辑 JSON 才能使修改生效。

#### Scenario: 修改输入步骤的标签与默认值
- **WHEN** 用户在 input 步骤的普通表单中修改输入标签、默认值或是否暴露为运行时参数
- **THEN** 页面 SHALL 立即更新 Flow 与 `task.json.inputs` 的高级预览
- **AND** 合法修改 SHALL 更新浏览器内的 review 草稿但不立即写入磁盘

#### Scenario: 切换动作类型
- **WHEN** 用户确认将标准步骤切换为另一种动作类型
- **THEN** 页面 SHALL 使用新动作的标准模板重建语义字段与 Flow
- **AND** 页面 SHALL 尽可能保留原步骤的前置等待时间

#### Scenario: 使用高级 JSON 编辑
- **WHEN** 用户显式启用高级编辑、修改 Flow 或参数 JSON并点击应用
- **THEN** 页面 SHALL 先解析并校验两个 JSON 缓冲区
- **AND** 只有校验成功时才 SHALL 反向更新语义表单和 review 草稿
- **AND** 默认只读的高级预览 SHALL 随普通表单内容实时变化
