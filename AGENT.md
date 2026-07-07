# AGENT

## 项目简介

本项目用于探索基于真实桌面环境的 Computer Use Agent（CUA）工作流。整体方向是：由 `showui-aloha` 负责教学录制信息处理，将录制视频、输入日志和截图转换为结构化日志与 trace；由 `CUA_midscene` 作为主执行器，消费 trace 或其转换后的 Midscene flow，并通过 Midscene computer use 操作本地 Chrome、堡垒机、远程桌面或企业内网页系统。

当前项目不以 browser-use、Playwright、Puppeteer 或 CDP 作为执行底座。主执行路径应围绕 Midscene computer use 展开。

## 规范

1. 开发过程、文档、提交说明和面向用户的回复均应使用中文；必要的代码标识、API 名称、命令、文件路径和第三方专有名词可以保留英文。
