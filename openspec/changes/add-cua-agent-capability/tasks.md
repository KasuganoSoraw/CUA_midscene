## 1. Agent definition 与契约

- [x] 1.1 新增 canonical description、instructions、definition loader 和 Tool 名称定义
- [x] 1.2 新增 catalog、execute、workbench 的宿主无关 request/result 契约

## 2. Agent Tools

- [x] 2.1 实现 `cua_catalog` 薄适配并保留 ready/error catalog 结果
- [x] 2.2 实现显式 replay/guided/freeform `cua_execute` 映射和统一运行布局解析
- [x] 2.3 实现不强制打开系统浏览器的 `cua_workbench` 启动/复用与深链接结果

## 3. Workbench 与发布入口

- [x] 3.1 支持 Workbench 从 mode/scene/task 查询参数初始化目标页面
- [x] 3.2 增加 Agent Capability 公共索引、TypeScript build include、npm 子路径和发布资产
- [x] 3.3 更新中文 README，说明 Agent、Workbench、Core、Host 和依赖生命周期边界
- [x] 3.4 删除旧 `agent-runtime` 精简包源码、打包脚本、构建入口、专项测试和文档说明
- [x] 3.5 实现统一 Subagent invocation contract、Host 注入边界和 Review Server API
- [x] 3.6 在现有 Workbench 增加薄 Agent 调试页签，展示可用状态、回复和 Tool 轨迹
- [x] 3.7 增加 `review --dev`，默认隐藏 Agent 页签并仅在开发模式注册 invocation API

## 4. 验证

- [x] 4.1 增加 definition、catalog、execute 和 workbench Tool 的确定性测试
- [x] 4.2 运行类型检查、完整测试、完整构建、发布面检查和 OpenSpec 严格验证
- [x] 4.3 验证普通/开发模式显隐、CLI 透传、服务复用兼容性并重新严格验证
