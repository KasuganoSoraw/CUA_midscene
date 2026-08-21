## 1. Python 录制器骨架与显示器能力

- [x] 1.1 创建独立 `recorder/` Python 3.11 工程、模块 CLI、stdio JSONL 协议和基础测试
- [x] 1.2 使用 `ctypes` 实现 DPI awareness、显示器枚举、物理坐标模型和 FFmpeg 单帧预览
- [x] 1.3 实现 FFmpeg 路径解析、版本/捕获器/`h264_mf` 能力探测及明确错误

## 2. Win32 键鼠记录与资产写入

- [x] 2.1 使用专用消息线程实现 `WH_KEYBOARD_LL` 与 `WH_MOUSE_LL` 的安装、入队、Hook 链和卸载
- [x] 2.2 实现键名、活动窗口、press/release、滚轮、双击和拖拽到现有 Aloha JSONL 消息的格式化
- [x] 2.3 实现 FFmpeg 录制生命周期、首帧握手、共享时间轴、stdin 停止、临时文件和成功原子完成
- [x] 2.4 为显示器、事件格式、进程失败、重复停止和完整/失败资产布局补充 Python 测试

## 3. Review 服务录制编排

- [x] 3.1 在 TypeScript 服务中实现 Python Worker 路径解析、单会话状态机和无 shell 子进程控制
- [x] 3.2 增加状态、显示器刷新/预览、环境变量输出根、开始和停止 Fastify API，并限制预览及输出路径边界
- [x] 3.3 为正常录制、重复开始、Worker 失败、停止超时和缺失环境配置补充服务测试

## 4. Review 网页录制界面

- [x] 4.1 扩展 Web API 类型和客户端调用，增加显示器、输出根及录制状态模型
- [x] 4.2 在现有录制工作区实现静态双屏预览、刷新、只读显示环境变量目录、开始录制和录制中收起状态条
- [x] 4.3 增加禁用状态、中文错误、计时、停止交互和对应前端类型/构建验证

## 5. 集成验证与交付

- [x] 5.1 验证 OpenSpec、Python 测试、TypeScript 测试、类型检查和 Web 构建
- [x] 5.2 在可用 Windows FFmpeg 制品上完成真实单屏录制 smoke test，并用现有 catalog 与 `Aloha_Learn` 处理器验证 MP4+TXT
- [x] 5.3 补充 FFmpeg 固定制品配置、运行命令、首版限制和故障诊断文档

## 6. PyAV 后端替换与旧制品清理

- [x] 6.1 固定 PyAV Windows wheel，并验证其提供 `gdigrab`、`h264_mf`、MP4 muxer 及可审计的 FFmpeg 构建信息
- [x] 6.2 使用 PyAV 实现静态预览、首帧握手、录制、停止 flush 和 MP4 原子完成，保持 CLI/stdio 与资产格式不变
- [x] 6.3 更新 Python 单元测试并完成真实 Windows 录制、停止、MP4 可读性和现有 catalog/处理器 smoke test
- [x] 6.4 验证通过后移除 `ffmpeg.exe` 制品、FFmpeg 路径配置、子进程实现、旧测试和交付文档

## 7. 无浏览器污染的全局快捷键录制

- [x] 7.1 使用 `ctypes` 实现带冲突检测和 `MOD_NOREPEAT` 的 Win32 全局切换快捷键，并过滤控制快捷键输入事件
- [x] 7.2 将 Worker 改为 `armed → starting → recording → stopping` 生命周期，准备阶段不创建资产，并支持 stdin 取消/紧急停止且不播放提示音
- [x] 7.3 扩展 Fastify/Vue 状态机和页面文案，使“准备录制”返回 `armed`、轮询实际录制状态并保留取消/紧急停止按钮
- [x] 7.4 补充 Python/TypeScript 测试、OpenSpec 校验和真实 Windows 全局快捷键 smoke test，并重启 review 服务

## 8. 桌面视频清晰度

- [x] 8.1 使用显式高质量模式定位桌面宏块与文件体积问题，并增加编码配置测试
- [x] 8.2 使用真实 1080p Windows 桌面录制验证编码器质量参数、MP4 可解码性与输出码率

## 9. 恢复帧间压缩并对齐 Aloha 体积

- [x] 9.1 清除 `gdigrab` 捕获帧继承的强制 I-frame 类型，配置目标 5 Mbps VBR 和 6 秒 GOP，并增加帧类型回归测试
- [x] 9.2 对比真实录制的关键帧数量、平均码率、文件体积和解码帧清晰度，确认接近 Aloha 样本
