## 1. 录制参考图

- [x] 1.1 为 click/doubleClick 生成 `96×96` 无标注 PNG reference patch，并在 processed log 记录路径
- [x] 1.2 增加截图处理测试，验证现有红叉 crop 不变、参考图干净且非点击动作不生成参考图

## 2. Trace 契约

- [x] 2.1 更新中文 trace prompt，约束模型仅在必要点击步骤输出 `useReferenceImage: true`
- [x] 2.2 扩展 trace 清洗、类型和 JSON Schema，拒绝非点击动作或非法类型使用视觉参考
- [x] 2.3 增加 trace 生成测试，覆盖保留、忽略和拒绝视觉参考建议

## 3. Midscene YAML 转换与执行

- [ ] 3.1 转换视觉参考 click/doubleClick 为原生 `locate.prompt` 与 `locate.images`，缺失证据时显式失败
- [ ] 3.2 在 resolver 中将任务内本地图片路径解析为经过验证的绝对路径，保留 HTTP(S) 与 data URL
- [ ] 3.3 扩展录制任务整体 aiAct 投影，汇总并保留参考图片 prompt
- [ ] 3.4 增加转换、resolver、YAML parser 和 aiAct prompt 测试

## 4. 文档与验证

- [ ] 4.1 更新根 README、record README、execution README、Skill 和任务契约，说明参考图资产与执行边界
- [ ] 4.2 运行 Python 测试、TypeScript 类型检查与测试、OpenSpec 严格验证，并检查没有引入兜底路径
