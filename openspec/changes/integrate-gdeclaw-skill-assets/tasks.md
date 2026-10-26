## 1. 正式资产

- [x] 1.1 定义 Skill Manifest、task.json Schema、统一根目录和安全解析
- [x] 1.2 实现合法 Skill 发现、身份校验、原子安装及失败清理

## 2. 录制生成

- [x] 2.1 复用模型客户端归纳 Skill 元数据，复用 Trace 转换生成资产
- [x] 2.2 无命名表单的录制生成写入正式 Skill 根并返回 skillName

## 3. Workbench

- [x] 3.1 实现 Skill API、正式资产保存、删除与参考图操作
- [ ] 3.2 平铺 Skill 列表、生成完成导航、guided 默认调试与草稿隔离
- [x] 3.3 服务复用身份包含 Skill 根并保留宿主独立入口

## 4. 执行与交付

- [x] 4.1 Agent、Runtime 与 CLI 支持 skillName、guided 默认及不可变绑定
- [ ] 4.2 覆盖安全、生成、编辑、执行与终态回归并运行质量检查
- [ ] 4.3 更新配置、迁移与宿主集成文档，记录未验证的内部生命周期机制
