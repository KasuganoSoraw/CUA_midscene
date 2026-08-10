---
name: cua-agent-runtime
description: 当用户要求操作真实 Windows 桌面、打开或控制应用、通过视觉操作网页或在无法使用剪贴板的远程环境中输入 ASCII 文本时，使用本 Skill 调用 CUA Agent Runtime。
---

# CUA Agent Runtime

本包是 CUA 首期 Agent 集成运行时，只提供无录制自然语言 Computer Use。执行底座为 Midscene computer use，不使用 browser-use、Playwright、Puppeteer 或 CDP。

## 调用

已安装全局命令时：

```powershell
cua act run --prompt "<完整电脑操作要求>" --data-root "<外部可写绝对目录>"
```

从解压或安装目录调用时：

```powershell
node dist/agent-runtime/cli.js act run --prompt "<完整电脑操作要求>" --data-root "<外部可写绝对目录>"
```

`--data-root` 可以由 `CUA_DATA_ROOT` 代替。只检查参数、prompt 和报告生成时增加 `--dry-run`；dry-run 不操作电脑、不初始化 ComputerDevice，也不调用模型。

## Agent 规则

- 仅当用户明确要求操作电脑时执行非 dry-run 命令。
- 将用户完整操作意图放入一个 `--prompt`，不要自行拆成多个并发命令。
- 真实电脑操作必须串行执行，同一时刻不得启动多个 CUA 命令。
- 为命令设置较长超时。模型规划和桌面操作可能长时间没有控制台输出，不得因短暂无输出提前终止；仅在持续较长时间没有新输出且任务明显无进展时尝试终止。
- ASCII 文本由 `KeyboardTypeText` 通过键盘事件输入，不使用默认 Input 或剪贴板。不支持的字符直接失败。
- 失败后原样报告错误并等待用户决定，不得自动重试、切换执行方式、修改 prompt 或使用替代输入动作。
- 首期包不包含场景、录制任务、trace 转换、任务创建或复核页面，不得调用未提供的 `task`、`recording` 或 `review` 命令。

## 配置

真实执行前必须提供：

```text
MIDSCENE_MODEL_BASE_URL
MIDSCENE_MODEL_NAME
MIDSCENE_MODEL_API_KEY
MIDSCENE_MODEL_FAMILY
CUA_DATA_ROOT
```

可以通过宿主进程环境变量配置，也可以在包根依据 `.env.example` 创建不纳入版本管理的 `.env.local`。不得把真实密钥写入 Skill、命令参数或运行报告。

## 输出

stdout 只输出一个 JSON，包含 `runDir`、prompt/result 路径和 Midscene 执行结果。运行报告写入 `<CUA_DATA_ROOT>/runs/<run-id>/`，包安装目录保持只读。
