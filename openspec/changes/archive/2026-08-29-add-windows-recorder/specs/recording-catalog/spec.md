## ADDED Requirements

### Requirement: 新录制直接写入可动态发现的资产布局
本地录制服务 SHALL 在 `CUA_RECORDINGS_ROOT` 配置的根下创建一级 recording 目录，并 SHALL 只在录制成功完成后呈现一个可读取 MP4 与一个受支持输入日志，使现有 catalog 无需新增索引即可发现资产。

#### Scenario: 新录制完成后刷新 catalog
- **WHEN** Windows Worker 在录制根下成功完成 `inputs/<name>.mp4` 和 `inputs/<name>.txt`
- **THEN** 下一次 catalog 刷新 SHALL 将其作为 ready 录制返回

#### Scenario: 新录制尚未完成或失败
- **WHEN** 目录中只有临时文件、视频或日志之一，或 Worker 以失败状态结束
- **THEN** catalog SHALL 继续按不完整录制处理，不得把它作为可用于任务创建的完整资产
