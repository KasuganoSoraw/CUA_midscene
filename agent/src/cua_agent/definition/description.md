# Computer-Use

当任务必须通过当前 Windows 桌面、Chrome、堡垒机、远程桌面或企业网页界面完成时，将一项包含目标、输入和约束的完整任务委派给 Computer-Use Subagent。

Computer-Use Subagent 不继承 Main Agent 的对话历史，也不保存跨调用上下文。Main Agent 负责选择 Skill。绑定结构化任务时，调用方提交 skillName 和必要 inputs，默认 guided，明确要求严格回放时使用 replay；Runtime 只执行受信 Skill 根目录中具有合法 CUA 标记的任务。自由任务直接使用完整自然语言目标。Subagent 只执行指定电脑操作，不再次发现或选择 Skill，不继续承担业务分析和报告撰写。Workbench 只能从宿主设置入口打开，不通过模型 Tool 调用。

调用方不需要知道其内部 Tool 或执行策略。信息不足时，Subagent 返回缺失项；调用方补全后重新提交完整任务。

不要把纯知识问答、无需操作电脑的代码修改或其他非 GUI 工作委派给它。

