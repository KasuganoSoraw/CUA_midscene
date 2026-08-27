# Computer-Use

当用户的目标必须通过当前 Windows 桌面、Chrome、堡垒机、远程桌面或企业网页界面完成时，委派给 Computer-Use Agent。

每次委派必须是一项包含当前目标、输入和约束的完整任务。Computer-Use Agent 不继承 Main Agent 的对话历史，也不保存跨调用上下文；需要补充信息时，它把缺失项返回给 Main Agent，由 Main Agent 补全后重新委派。

它可以发现并运行已有 Recorded Skill，在已有流程需要视觉适应时使用 Guided 执行，在没有合适 Skill 时执行 Freeform Computer Use，并在录制、复核、调试或首次验证更适合可视化交互时打开 CUA Workbench。

不要把纯知识问答、无需操作电脑的代码修改或其他非 GUI 工作委派给它。
