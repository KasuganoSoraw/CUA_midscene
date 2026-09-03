## MODIFIED Requirements

### Requirement: 本地服务使用环境变量配置录制根
本地 review 服务 SHALL 按统一配置优先级从进程环境、组件或仓库根 `.env.local`、同一根 `.env` 读取 `CUA_RECORDINGS_ROOT`，并 SHALL 只向页面返回已验证的绝对目录用于显示和后续准备请求；浏览器 SHALL NOT 打开系统目录选择器或提交任意输出路径。

#### Scenario: 服务读取有效目录
- **WHEN** 服务启动时从配置中解析到存在的绝对录制目录
- **THEN** 页面 SHALL 显示该目录并允许将其作为新录制的输出根

#### Scenario: 未配置录制目录
- **WHEN** 服务未解析到 `CUA_RECORDINGS_ROOT`
- **THEN** 页面 SHALL 禁用准备操作并提示在仓库根 `.env.local` 中配置后重启服务
