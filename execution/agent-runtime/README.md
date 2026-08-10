# CUA Agent Runtime

这是 `cua-midscene` 的首期 Agent 精简发布物，只包含自然语言 Midscene computer use 和无剪贴板 `KeyboardTypeText`。完整工程中的录制、任务、转换、内置项目和复核前端不在本包内。

## 环境

要求 Node.js `>=22.18.0`。依据 `.env.example` 配置模型与外部数据根，真实凭证只能放在宿主进程环境或本地 `.env.local`。

## CLI

```powershell
cua act run --prompt "打开 Chrome 并搜索 GUI agent" --data-root "C:\cua-data"
cua act run --prompt "打开 Chrome 并搜索 GUI agent" --data-root "C:\cua-data" --dry-run
```

如果没有安装全局 bin：

```powershell
node dist/agent-runtime/cli.js act run --prompt "打开 Chrome 并搜索 GUI agent" --data-root "C:\cua-data"
```

CLI stdout 始终为单个 JSON。真实执行可能长时间没有控制台输出，Agent Host 应设置较长超时并串行调用电脑操作。

## Node API

```ts
import { runNaturalLanguageAiAct } from 'cua-agent-runtime';

const run = await runNaturalLanguageAiAct({
  prompt: '打开 Chrome 并搜索 GUI agent',
  runsRoot: 'C:\\cua-data\\runs',
});
```

API 和 CLI 都直接调用原生 `agent.aiAct()`，不会生成任务 YAML。失败会保留原始错误，不自动重试或切换模式。

## 能力边界

- 支持自然语言电脑操作、视觉定位和普通鼠标键盘动作。
- ASCII 输入使用 `KeyboardTypeText` 逐键输入，不依赖剪贴板。
- 不包含 `task`、`recording`、`review` 命令。
- 不使用 browser-use、Playwright、Puppeteer 或 CDP。
