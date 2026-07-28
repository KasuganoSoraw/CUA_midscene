## MODIFIED Requirements

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
