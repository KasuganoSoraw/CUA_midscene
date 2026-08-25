# local-task-review-app Specification

## Purpose

定义随 CUA 执行器发布的本地任务复核控制台，包括任务资产组合、录制证据展示、语义步骤编辑、版本校验与安全保存边界。
## Requirements
### Requirement: 本地复核应用随执行器发布
系统 SHALL 将复核应用的 Fastify 服务端与 Vue 3 前端构建产物随 `cua-midscene` 包发布，并通过统一命令启动仅监听 loopback 的临时本地服务；服务端框架迁移 SHALL 保持既有 CLI 和 HTTP 契约兼容。

#### Scenario: 首次启动复核控制台
- **WHEN** 用户在 Node.js 22.18.0 或更高版本调用 `cua review`、具有有效的 `CUA_DATA_ROOT`，且 `127.0.0.1:47831` 空闲
- **THEN** 系统 SHALL 在 `127.0.0.1:47831` 启动服务
- **AND** 系统 SHALL 提供不含访问 token、可由系统浏览器打开的本地 URL

#### Scenario: 重复启动相同复核服务
- **WHEN** `127.0.0.1:47831` 已运行协议兼容且数据根一致的 CUA review 服务
- **THEN** 新的 `cua review` 调用 SHALL 复用现有 URL
- **AND** 调用 SHALL NOT 创建新的 Fastify listener 或 Node 服务进程

#### Scenario: 默认端口由其他服务占用
- **WHEN** `127.0.0.1:47831` 被其他程序、协议不兼容或数据根不同的 review 服务占用
- **THEN** 启动 SHALL 明确失败并说明端口冲突
- **AND** 系统 SHALL NOT 自动尝试其他端口或终止占用进程

#### Scenario: 发布环境离线使用
- **WHEN** 目标机器无法访问远程服务器
- **THEN** 复核页面 SHALL 仍可从包内静态资源加载并读写本地 user catalog
- **AND** 系统 SHALL NOT 要求数据库或远程 API

#### Scenario: Fastify 迁移保持接口兼容
- **WHEN** 现有 Vue 前端或 CLI 调用 review server
- **THEN** 服务 SHALL 保持既有请求路径、HTTP 方法、成功响应和业务错误状态码
- **AND** 未知 API SHALL 返回结构化 404，非 API 页面路径 SHALL 回退到 Vue 入口

### Requirement: 复核应用组合现有任务资产
复核服务 SHALL 从 CUA catalog API 发现 builtin 与 user 场景和任务，并将 `task.yaml`、`task.json` 与只读 `source/` 组合成供前端消费的复核视图，而不得创建第二份长期执行流程；步骤中 canonical `locate.images` SHALL 作为执行定位参考资产展示。

#### Scenario: 查看录制任务
- **WHEN** 用户在页面选择一个合法任务
- **THEN** 页面 SHALL 展示任务步骤、输入定义、origin、writable、全局截图和局部截图
- **AND** 步骤内容 SHALL 来源于 canonical `task.yaml`

#### Scenario: 查看带参考图的点击步骤
- **WHEN** 点击或双击步骤具有 `screenshot_reference`，或者 `locate.images` 引用任务 `source/` 内的图片
- **THEN** 页面 SHALL 展示每张可用目标小图或参考图及其名称和 canonical 路径
- **AND** 页面 SHALL 区分录制时可用但 YAML 未绑定的目标小图与已用于执行定位的参考图
- **AND** 页面 SHALL 将两者与带点击标记的录制局部图区分
- **AND** 步骤存在局部图时 SHALL 默认展示局部图，用户可显式切换到参考图

#### Scenario: 查看内置任务
- **WHEN** 用户选择 builtin catalog 中的任务
- **THEN** 页面 SHALL 允许查看任务、录制证据和参考图
- **AND** 页面 SHALL 禁用保存并明确展示只读状态

#### Scenario: 当前步骤没有录制截图
- **WHEN** 当前步骤没有自身绑定的局部图和全局图
- **THEN** 页面 SHALL 展示中性的默认占位图
- **AND** 页面 SHALL NOT 使用其他步骤的截图冒充或替代当前步骤证据

### Requirement: 定位参考图通过普通界面管理
本地 review 页面 SHALL 将录制阶段可用的 `screenshot_reference` 与 YAML 已绑定的 `locate.images` 统一呈现为“定位参考图”，并 SHALL 允许用户在受支持的可写步骤中通过普通界面决定单张录制定位参考图是否参与执行定位，而无需直接编辑 JSON。

#### Scenario: 展示单张定位参考图
- **WHEN** 当前步骤存在一张录制定位参考图或一张已绑定定位参考图
- **THEN** 页面 SHALL 使用“定位参考图”作为页签和区域名称
- **AND** 页面 SHALL NOT 显示“目标小图 1”或其他单图数量描述
- **AND** 页面 SHALL 说明该图片帮助 Midscene 识别目标外观且不表示固定点击坐标
- **AND** 当前步骤存在局部录制图时 SHALL 继续默认展示局部图

#### Scenario: 将录制定位参考图用于定位
- **WHEN** 可写的标准 click 或 doubleClick 步骤存在一张未绑定的录制定位参考图，且用户点击“用于定位”
- **THEN** 页面 SHALL 将该图片作为唯一候选加入当前步骤草稿的 `locate.images`
- **AND** 页面 SHALL 保留目标描述与动作前等待时间
- **AND** 高级 JSON、变更对比和绑定状态 SHALL 立即联动
- **AND** 页面 SHALL NOT 在用户确认写入前修改磁盘资产

#### Scenario: 取消使用已绑定定位参考图
- **WHEN** 可写的标准 click 或 doubleClick 步骤只绑定一张定位参考图，且用户点击“取消使用”
- **THEN** 页面 SHALL 从当前步骤草稿中移除 `locate.images`
- **AND** 页面 SHALL 保留目标描述、动作前等待时间和 `source/` 中的图片文件
- **AND** 高级 JSON、变更对比和绑定状态 SHALL 立即联动

#### Scenario: 只读或不支持的步骤
- **WHEN** 当前任务为 builtin、步骤不是标准 click/doubleClick、页面处于高级编辑或保存忙碌状态
- **THEN** 页面 SHALL 继续展示可用的定位参考图和当前绑定状态
- **AND** 页面 SHALL 禁用绑定操作并说明不可操作原因

#### Scenario: 已有 YAML 绑定多张定位参考图
- **WHEN** 当前步骤的 canonical `locate.images` 包含两张或更多图片
- **THEN** 页面 SHALL 完整展示并无损保留全部图片引用
- **AND** 普通界面 SHALL NOT 提供会将多图静默替换、压缩或全部移除的单图绑定操作
- **AND** 页面 SHALL 提示该步骤需要通过高级 JSON 维护多图配置

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
页面 SHALL 将标准 Midscene 步骤解析为与动作类型对应的语义字段，并由这些字段实时生成 Flow 和当前步骤参数定义；页面 SHALL NOT 要求普通用户直接编辑 JSON 才能使修改生效，且带 `locate.images` 的点击类动作 SHALL 保持图片引用完整。

#### Scenario: 修改输入步骤的标签与默认值
- **WHEN** 用户在 input 步骤的普通表单中修改输入标签、默认值或是否暴露为运行时参数
- **THEN** 页面 SHALL 立即更新 Flow 与 `task.json.inputs` 的高级预览
- **AND** 合法修改 SHALL 更新浏览器内的 review 草稿但不立即写入磁盘

#### Scenario: 修改带参考图点击步骤的目标描述
- **WHEN** 用户在普通表单中修改带 `locate.images` 的点击或双击步骤目标描述
- **THEN** 页面 SHALL 更新 `locate.prompt`
- **AND** 页面 SHALL 保留原有图片名称、URL 和动作前等待时间

#### Scenario: 切换动作类型
- **WHEN** 用户确认将标准步骤切换为另一种动作类型
- **THEN** 页面 SHALL 使用新动作的标准模板重建语义字段与 Flow
- **AND** 页面 SHALL 尽可能保留原步骤的前置等待时间

#### Scenario: 使用高级 JSON 编辑
- **WHEN** 用户显式启用高级编辑、修改 Flow 或参数 JSON 并点击应用
- **THEN** 页面 SHALL 先解析并校验两个 JSON 缓冲区
- **AND** 只有校验成功时才 SHALL 反向更新语义表单、参考图展示和 review 草稿
- **AND** 默认只读的高级预览 SHALL 随普通表单内容实时变化

### Requirement: 本地复核应用提供从录制创建任务页
本地 review 应用 SHALL 提供独立于任务步骤编辑器的“从录制创建任务”页签，并 SHALL 使用与现有任务选择一致的左侧列表和右侧详情布局。

#### Scenario: 浏览录制目录
- **WHEN** 用户进入录制创建页且录制根可用
- **THEN** 左侧 SHALL 展示动态发现的录制目录
- **AND** 右侧 SHALL 使用占位卡片展示视频和事件日志名称、大小及录制基本信息
- **AND** 页面 SHALL NOT 尝试播放视频或加载完整事件日志正文

#### Scenario: 录制根未配置
- **WHEN** 用户进入录制创建页且录制根不可用
- **THEN** 页面 SHALL 展示 `CUA_RECORDINGS_ROOT` 配置提示
- **AND** 页面 SHALL 展示 `execution/.env.local` 配置位置、绝对路径示例和重启提示
- **AND** 页面 SHALL NOT 提供修改环境文件或启动桌面目录选择器的操作
- **AND** 任务复核页签 SHALL 继续可用

### Requirement: 下拉字段采用一致且可访问的交互样式
本地 review 应用 SHALL 对 Select 与可编辑 Combobox 使用一致的字段尺寸、边框、尾部箭头和交互状态，同时 SHALL 保留二者各自正确的语义与键盘行为。

#### Scenario: 悬浮或聚焦下拉字段
- **WHEN** 用户悬浮或聚焦任一下拉字段
- **THEN** 完整字段 SHALL 显示统一的 hover 或 focus 状态
- **AND** 尾部箭头 SHALL NOT 使用遮挡字段右下角圆角的大面积独立背景

#### Scenario: 展开任务复核纯选择字段
- **WHEN** 用户展开任务复核页的场景、动作类型或输入方式字段
- **THEN** 页面 SHALL 使用与录制创建场景 Combobox 一致的弹层、选项和选中状态
- **AND** 控件 SHALL 支持方向键移动、Enter 或 Space 选择以及 Escape 关闭

### Requirement: 用户通过语义表单创建完整任务
录制创建页 SHALL 允许用户选择或输入场景、输入任务标识和可选目标，并 SHALL 在一次操作中创建完整可复核任务，而不暴露 trace 等内部产物。

#### Scenario: 创建到已有场景
- **WHEN** 用户从 Combobox 选择已有 scene、输入不存在的 task 并选择有效录制
- **THEN** 页面 SHALL 提交完整任务创建请求
- **AND** goal 留空时 SHALL 以空任务描述创建

#### Scenario: 创建到新场景
- **WHEN** 用户在 Combobox 输入合法的新 scene ID
- **THEN** 系统 SHALL 使用该 ID 创建新用户场景和任务
- **AND** 新场景初始 title SHALL 使用该 scene ID

#### Scenario: 生成任务期间
- **WHEN** 完整任务创建请求尚未结束
- **THEN** 页面 SHALL 展示“正在生成任务”的不确定进度状态
- **AND** 页面 SHALL 禁用录制选择、表单和重复提交
- **AND** 页面 SHALL NOT 展示虚假百分比或要求流式日志

#### Scenario: 创建成功
- **WHEN** 服务成功创建并验证完整任务
- **THEN** 页面 SHALL 刷新任务 catalog
- **AND** 页面 SHALL 自动切换到任务复核页并打开新任务

#### Scenario: 创建失败
- **WHEN** 创建流程返回错误
- **THEN** 页面 SHALL 恢复表单并在页面内展示错误
- **AND** 页面 SHALL NOT 使用浏览器原生 alert

### Requirement: 本地工作台提供任务运行入口
本地网页 SHALL 在“任务复核”和“从录制创建任务”之外提供并列的“任务运行”页签，并 SHALL 在当前任务复核区域提供运行快捷入口。

#### Scenario: 直接打开任务运行页
- **WHEN** 用户点击“任务运行”页签
- **THEN** 系统展示独立运行工作区且不改变默认打开“任务复核”的行为

#### Scenario: 从当前任务快捷进入
- **WHEN** 用户在已加载任务的复核页点击运行入口
- **THEN** 系统打开任务运行页并预选当前场景和任务

#### Scenario: 保存并运行可写草稿
- **WHEN** 当前可写任务包含未保存修改
- **THEN** 快捷入口明确表达“保存并运行”，并仅在保存成功后跳转到运行页

#### Scenario: 内置任务快捷进入
- **WHEN** 当前任务为只读内置任务且用户点击运行入口
- **THEN** 系统无需保存即可打开运行页并预选该任务

