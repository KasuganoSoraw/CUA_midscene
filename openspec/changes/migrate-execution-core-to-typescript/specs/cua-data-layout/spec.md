## MODIFIED Requirements

### Requirement: Midscene 输出绑定本次运行
TypeScript 执行编排 SHALL 为每次调用显式提供绝对 run directory，并保证 Midscene 报告目录配置在同一进程内不会被并发调用覆盖。

#### Scenario: 实际运行生成 Midscene 报告
- **WHEN** Midscene runner 创建报告、截图或日志
- **THEN** 这些文件 SHALL 位于 `<run-dir>/midscene/`
- **AND** 静态环境文件中的同名配置 SHALL NOT 将其重定向到共享 Skill 目录

#### Scenario: 多个进程请求同一本地电脑
- **WHEN** 已有电脑操作正在执行且同一工具服务或独立 CLI 进程发起另一次实际执行
- **THEN** 后续执行 SHALL 通过同一主机级独占锁等待前一执行完成后再设置自己的目录
- **AND** 执行器 SHALL 在 `finally` 中恢复调用前的环境值
