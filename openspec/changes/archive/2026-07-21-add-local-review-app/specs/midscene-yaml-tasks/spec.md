## MODIFIED Requirements

### Requirement: 录制任务保留稳定步骤身份
录制任务的每个 `tasks[]` 项 SHALL 使用 `step-NNN | <operation-type>` 名称并按当前执行顺序连续、严格递增；普通内容校准 SHALL 保持步骤编号不变，显式结构编辑 SHALL 在一个受控事务中重编号步骤及其关联输入和证据绑定。整体业务目标 SHALL 写入 `agent.groupDescription` 而非步骤名称。

#### Scenario: 人工修改破坏步骤身份
- **WHEN** task 名称不符合约定、步骤重复、编号不连续、顺序倒置或启用 `continueOnError`
- **THEN** resolver SHALL 在启动 Midscene 前失败

#### Scenario: 受控插入步骤
- **WHEN** 复核应用确认在任务中间插入、删除或移动步骤
- **THEN** 系统 SHALL 重新生成连续 `step-NNN` 名称并同步相关输入与证据绑定
- **AND** 保存后的任务 SHALL 通过与执行时相同的 resolver 校验

#### Scenario: Midscene 报告执行失败
- **WHEN** 某个录制步骤执行失败
- **THEN** 报告 SHALL 使用当前 task 名称定位失败步骤
- **AND** 复核应用 SHALL 通过证据绑定定位其原始 trace step（如存在）
- **AND** 后续步骤 SHALL NOT 被继续执行
