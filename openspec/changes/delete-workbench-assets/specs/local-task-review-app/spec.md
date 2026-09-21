# Spec Delta

## ADDED Requirements

### Requirement: 本地工作台安全删除用户资产
本地 review 应用 SHALL 允许用户删除 user catalog 中的单个任务或录制根中的单个原始录制目录，并 SHALL 在执行不可逆删除前通过应用内双语确认对话框明确展示目标和影响范围；删除能力 SHALL NOT 作用于 builtin 任务、场景本身、任务运行产物或 catalog 边界外的路径。

#### Scenario: 删除用户任务
- **WHEN** 用户对可写的 user 任务发起删除并在应用内确认
- **THEN** 服务 SHALL 仅删除该任务对应的完整任务目录
- **AND** 页面 SHALL 刷新场景与任务列表、清除已删除任务的复核草稿和选择状态
- **AND** 同一场景及其余任务 SHALL 保持不变

#### Scenario: 拒绝删除内置或冲突任务
- **WHEN** 用户尝试删除 builtin 任务、不可写任务或无法唯一解析的同名冲突任务
- **THEN** 服务 SHALL 拒绝删除并返回可展示的错误
- **AND** 任何候选任务目录 SHALL NOT 被修改

#### Scenario: 删除原始录制
- **WHEN** 用户对录制 catalog 中的原始录制发起删除并在应用内确认
- **THEN** 服务 SHALL 仅删除录制根下该一级录制目录及其内部资产
- **AND** 页面 SHALL 刷新录制列表并选择剩余的可用录制
- **AND** 已从该录制生成的任务 SHALL 保持不变

#### Scenario: 拒绝删除活动录制
- **WHEN** 录制器处于准备、等待开始、启动、录制或停止阶段，且用户请求删除当前录制或其他原始录制
- **THEN** 服务 SHALL 拒绝录制删除请求
- **AND** 页面 SHALL 保留当前录制状态和 catalog 内容

#### Scenario: 删除目标不存在或越界
- **WHEN** 删除请求中的 scene、task 或 recording 标识无法解析为 catalog 内唯一存在的允许目标
- **THEN** 服务 SHALL 返回资源不存在或非法请求错误
- **AND** 服务 SHALL NOT 扩大目标、删除父目录或访问配置根之外的路径

#### Scenario: 取消删除
- **WHEN** 用户打开删除确认对话框后选择取消或关闭
- **THEN** 页面 SHALL 关闭对话框且不发送删除请求
- **AND** 当前选择、草稿和磁盘资产 SHALL 保持不变
