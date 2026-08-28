# Computer-Use

当任务必须通过当前 Windows 桌面、Chrome、堡垒机、远程桌面或企业网页界面完成时，将一项包含目标、输入和约束的完整任务委派给 Computer-Use Subagent。

Computer-Use Subagent 不继承 Main Agent 的对话历史，也不保存跨调用上下文。它自行发现并判断是否使用 Recorded Skill，在需要视觉适应时选择 Guided，在没有合适 Skill 时选择 Freeform，并可在录制、复核、调试或首次验证更适合可视化交互时打开 CUA Workbench。

调用方不需要知道其内部 Tool 或执行策略。信息不足时，Subagent 返回缺失项；调用方补全后重新提交完整任务。

不要把纯知识问答、无需操作电脑的代码修改或其他非 GUI 工作委派给它。

