# CUA Record

录制后处理 Worker，将原始录制目录中的视频与键鼠日志转换为结构化日志、截图和 trace，供执行器初始化任务。包内 `resources/default_prompt.json` 和 `resources/default_prompt.en.json` 是 trace 生成的运行资源。

`python -m cua_record process <录制目录>` 执行处理，`python -m cua_record doctor` 检查模块和默认 prompt。步骤描述默认使用中文；传入 `--language en-US` 时，新生成的步骤描述和任务摘要使用英文。工作台及 `task create-from-recording` 使用已安装的 `cua_record` 模块，不依赖示例目录。

点击或双击的参考小图保留目标真实外观，供执行器语义定位；带标记 crop 用于理解录制证据，两者不能互相替代。输入 ID、长期任务流程和本次运行参数由 TypeScript Runtime 管理，本包不负责回放。

模型、数据路径和运行依赖由宿主准备与注入，构建及组件交付说明见 [集成说明](../README.md)。源码许可证见 [LICENSE](LICENSE)。
