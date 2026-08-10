## 1. Agent Runtime 入口

- [x] 1.1 提取可复用的数据根解析，使完整 CLI 与精简 CLI 共享外部运行目录规则
- [x] 1.2 新增仅支持 `act run --prompt` 的 Agent Runtime CLI，并保持 stdout JSON 与原始错误契约
- [x] 1.3 新增窄包根 API 导出，确认导入链不包含任务、录制、转换或 Review 模块

## 2. 精简发布物

- [ ] 2.1 新增 Agent Runtime 中文 `SKILL.md`、README 和无敏感信息环境示例
- [ ] 2.2 实现唯一 `package:agent` 命令，按白名单生成暂存目录和 npm tgz
- [ ] 2.3 确保精简包只声明 Midscene、dotenv 等必要生产依赖，并排除本地配置、用户数据和完整工程资产

## 3. 验证

- [ ] 3.1 增加 Agent Runtime CLI 参数、dry-run、数据根和错误测试
- [ ] 3.2 增加发布清单、窄 API 依赖边界和 tgz 安装后 smoke test
- [ ] 3.3 运行 TypeScript 类型检查、完整测试、完整构建和 Agent Runtime 打包验证

## 4. 文档与交付

- [ ] 4.1 更新根 README、execution README 和完整 Skill，说明完整包与精简包差异及未来扩展方式
- [ ] 4.2 严格验证 OpenSpec，并按入口、打包、测试文档拆分中文小步提交
