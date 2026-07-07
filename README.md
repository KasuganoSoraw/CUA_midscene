# CUA

本项目用于探索面向真实桌面环境的 Computer Use Agent（CUA）方案。当前重点是验证一条可落地的路径：用户先通过录制产生可理解的操作信息，再由 Midscene 作为主执行器，在本地 Chrome、堡垒机、远程桌面或企业内网页系统中完成电脑操作。

项目短期目标不是做 browser-use，也不是直接通过 Playwright、Puppeteer、CDP 等浏览器自动化协议控制页面。目标场景是公司内环境中常见的“先经过堡垒机或远程桌面，再进入目标网页系统”的链路，因此底座优先选择视觉驱动的 computer use。

## 项目定位

当前仓库由两个子项目组成：

```text
CUA/
├── CUA_midscene/      # 主执行器：Midscene computer use 实验
│   └── projects/      # 按业务流程组织的 trace、IR、生成脚本和报告
└── showui-aloha/      # 教学录制侧：从录制资源生成结构化日志和 trace
```

### CUA_midscene

`CUA_midscene` 是本项目的主执行器目录，负责使用 `@midscene/computer` 操作真实桌面应用。

当前该目录不再保留早期手写实验脚本。后续企业网管系统的自动化执行会优先沉淀在这个目录下。Midscene 是主执行器，负责感知屏幕、定位元素、点击、输入和处理失败后的视觉回退。

`CUA_midscene/projects/<project-name>/` 用于保存单个业务流程的全部产物：

- `source/`：ShowUI-Aloha Learn 生成的 trace、processed log 和截图。
- `ir/`：转换后的 Midscene flow，例如 `midscene-flow.json`。
- `generated/`：后续从 flow 派生出的 Midscene 脚本。
- `reports/`：该流程执行产生的报告或报告引用。

### showui-aloha

`showui-aloha` 当前来自 ShowUI-Aloha 项目，但在本仓库中的定位会收窄：只作为“教学录制信息处理”的参考与实验目录。

也就是说，该目录现在只保留上游项目中与学习侧相关的能力；原本用于 Actor、Executor、执行和回放的 `Aloha_Act` 已删除。

- 读取录制产生的视频和输入日志。
- 抽取截图、鼠标、键盘等操作信息。
- 生成结构化操作日志。
- 生成可供后续模型理解的 trace。

本项目暂不计划把 ShowUI-Aloha 作为最终执行器。后续会基于它生成的结构化日志和 trace，转换成 Midscene 可用的 computer use 操作脚本或中间表示。这部分转换能力目前待实现。

## 总体流程设想

```text
用户教学录制
    ↓
ShowUI-Aloha Learn
    ↓
结构化操作日志 / trace
    ↓
转换为 Midscene 可执行流程（待实现）
    ↓
Midscene computer use 执行
    ↓
失败时回退到视觉理解和重新规划
```

这个拆分的核心原因是速度和稳定性：

- 录制阶段提供足够多的用户意图、页面上下文和操作轨迹。
- 固定流程可以尽量转换成脚本化或半脚本化执行，减少每一步都依赖视觉模型的成本。
- 当页面变化、坐标失效或流程失败时，再回退到 Midscene 的视觉操作能力。

## 环境与密钥

本项目当前使用火山 Ark 的 OpenAI 兼容接口进行实验：

```text
https://ark.cn-beijing.volces.com/api/coding/v3
```

模型名当前配置为：

```text
minimax-m3
```

真实 API Key 不应提交到仓库。请分别复制示例环境文件并在本地填写：

```powershell
Copy-Item CUA_midscene\.env.example CUA_midscene\.env.local
Copy-Item showui-aloha\.env.example showui-aloha\.env
```

其中：

- `CUA_midscene/.env.local` 用于 Midscene computer use。
- `showui-aloha/.env` 用于 ShowUI-Aloha learn 阶段调用 OpenAI 兼容接口生成 trace。

这些本地环境文件已经被 `.gitignore` 忽略。

## 运行 Midscene 转换与执行实验

进入 Midscene 目录：

```powershell
cd CUA_midscene
npm install
```

检查环境：

```powershell
npm run check
```

将 ShowUI-Aloha trace 转换为 Midscene flow：

```powershell
npm run flow:convert:air
```

这一步当前不调用模型，只做确定性规则映射。模型调用发生在 ShowUI-Aloha Learn 生成 trace 阶段，以及 Midscene runner 实际执行 flow 阶段。

使用通用 runner 执行 Midscene flow：

```powershell
npm run flow:run:air
```

注意：`flow:run:air` 是执行 flow，不是转换 trace。整体链路中，`flow:convert:air` 才是 trace 到 `midscene-flow.json` 的转换命令。

当前样例 flow 的第一步会被标记为 `manual-review`，runner 会在执行前 fail fast，避免把不明确的空白区域点击自动化。

注意：执行阶段使用的是 Midscene 的 computer use 能力，操作真实桌面应用。它不依赖 browser-use，也不通过浏览器调试协议直接控制网页。

## 运行 ShowUI-Aloha Learn 实验

进入 ShowUI-Aloha 目录：

```powershell
cd showui-aloha
uv sync
```

基于上游示例录制生成结构化日志和 trace：

```powershell
uv run python Aloha_Learn\parser.py Aloha_Learn\projects\air_tickets
```

该流程会处理录制资源，并生成 learn 阶段产物。当前这些生成物主要用于分析和转换实验，不作为最终执行入口。

## 当前边界

已完成：

- 初始化 Midscene computer use 实验工程。
- 配置火山 Ark OpenAI 兼容接口。
- 引入 ShowUI-Aloha，并跑通 learn 阶段的 trace 生成。
- 初步打通 ShowUI-Aloha trace 到 Midscene flow 的转换链路。
- 新增通用 runner，能够读取 `midscene-flow.json` 并在不明确步骤上 fail fast。

待实现：

- 定义 ShowUI-Aloha trace 到 Midscene computer use 的中间表示。
- 自动把录制产生的结构化日志转换成 Midscene 执行流程。
- 将一次成功执行的流程固化为更快的脚本化步骤。
- 在脚本失败时自动回退到 Midscene 视觉操作。
- 面向华为网管系统沉淀可复用的任务模板和失败恢复策略。

## 版本管理说明

本仓库以 `CUA` 根目录作为唯一 Git 仓库维护。`showui-aloha` 作为源码目录纳入当前项目，但不保留其上游 Git 历史。

本地密钥、依赖目录、运行报告、虚拟环境和生成 trace 默认不提交。
