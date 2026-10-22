# Computer-Use

当任务必须通过当前 Windows 桌面、Chrome、堡垒机、远程桌面或企业网页界面完成时，将一项包含目标、输入和约束的完整任务委派给 Computer-Use Subagent。

Computer-Use Subagent 不继承 Main Agent 的对话历史，也不保存跨调用上下文。收到完整自然语言操作流程或业务目标时直接执行 Freeform；只有明确要求执行一个具名专业任务或提供 task 标识时，才检索专业工作台任务并选择 Replay/Guided。普通 Skill 应展开为完整操作流程后提交，而不是只传 Skill 名称。录制示教返回操作日志与截图资产，正式 Skill 由调用方生成和管理。工作台由产品设置入口打开，不通过对话工具唤起。

调用方不需要知道其内部 Tool 或执行策略。信息不足时，Subagent 返回缺失项；调用方补全后重新提交完整任务。

不要把纯知识问答、无需操作电脑的代码修改或其他非 GUI 工作委派给它。

