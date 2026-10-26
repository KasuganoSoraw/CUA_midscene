## ADDED Requirements

### Requirement: Canonical Skill assets
系统 MUST 在独立临时目录生成完整单 Skill ZIP，包含 SKILL.md、cua-manifest.json、0.3 task.json、task.yaml 和 source，经宿主原生接口导入 CUA_SKILLS_ROOT。SKILL.md name、目录名及两个 JSON 身份 MUST 一致。

#### Scenario: Configured creation
- **WHEN** 用户选择可用录制并生成任务
- **THEN** 模型归纳语义名称、描述和目标，系统校验、打包、调用宿主导入并复核正式资产，无需场景和命名表单

#### Scenario: Missing configuration
- **WHEN** 未配置 CUA_SKILLS_ROOT 并请求创建、发现或绑定执行
- **THEN** 明确失败且不写入旧 projects 目录，freeform 不受影响

### Requirement: Ownership and filesystem boundary
系统 MUST 仅管理具有合法版本化 CUA Manifest 的完整 Skill，拒绝越界引用、符号链接越界、身份不一致及不完整资产。创建 MUST 不覆盖同名目录，组装失败仅清理本次临时目录；导入失败保留 ZIP，不删除宿主可能已安装的资产。

#### Scenario: Ordinary Skill
- **WHEN** 根目录中存在未标记普通 GDEClaw Skill
- **THEN** CUA 不列出、编辑、删除或执行该目录

#### Scenario: Occupied name
- **WHEN** 正式根中已有相同目录名或普通 Skill 的规范 name
- **THEN** 组装前追加安全随机后缀并统一身份，保持描述、目标、步骤和证据不变，不重复调用模型

#### Scenario: Native import failure
- **WHEN** 宿主导入返回失败、超时或导入后正式资产不可读
- **THEN** 创建失败并保留 ZIP 位置，不自动重传或换名；不确定结果提示先核实宿主状态

#### Scenario: Unsafe or concurrent asset
- **WHEN** 资产包含越界路径、非法标记或同名并发安装
- **THEN** 校验失败，现存目录及内容不被覆盖

### Requirement: Direct Workbench editing
Workbench MUST 平铺显示 Skill，以规范 name 选中、保存和执行。保存 MUST 写入正式资产，保留 revision 冲突与浏览器草稿保护，不提供发布或同步步骤。

#### Scenario: Save and reload
- **WHEN** 用户修改步骤或参数并保存
- **THEN** 正式 Skill 中 JSON/YAML 被更新，重新加载得到保存内容

### Requirement: Bound execution and host lifecycle
默认 SubAgent MUST 仅暴露 cua_execute，绑定 skillName 直接执行，缺省 guided，显式 replay；无绑定目标 MUST 使用 freeform。模型 MUST 不能修改绑定或提供文件路径。成功后 MUST 停止 Tool 操作。

#### Scenario: Bound Skill
- **WHEN** 宿主提交指定 skillName 和 inputs
- **THEN** Runtime 校验对应 CUA Skill 并执行，不搜索替代 Skill，绑定不一致在执行前失败

#### Scenario: Workbench root isolation
- **WHEN** 相同数据根但不同 Skill 根请求启动 Workbench
- **THEN** 不复用另一个根的服务，返回明确端口冲突或独立实例；页面由宿主打开
