## Context

TypeScript Runtime 的模型、数据根、录制根和 Python executable 分别在多个模块中读取 `execution/.env*`；Python 包本身只读取进程环境。组件产品态由 Host 注入进程环境，源码开发则需要一个可发现且不会进入发行物的根配置文件。

## Goals / Non-Goals

**Goals:**

- 为所有源码开发变量提供根 `.env.example` 与根 `.env.local`/`.env`。
- 让 TypeScript 的所有文件配置读取共享同一定位与优先级实现。
- 保持 Python 包只依赖进程环境，由开发命令显式加载根环境文件。
- 保持组件发行物和产品运行不携带或依赖环境文件。

**Non-Goals:**

- 不在环境文件中保存 Host 产品设置、Session 或任务数据。
- 不实现密钥管理器、加密存储或自动写入真实密钥。
- 不让已安装的 Python 包推测源码仓根目录。

## Decisions

### 1. 根环境文件是唯一开发文件入口

仓库只跟踪根 `.env.example`，本地使用根 `.env.local` 或 `.env`。三个子工程的 example 被删除，TypeScript 不再回退读取子目录文件。

将所有 example 保留在子工程的替代方案仍会造成变量发现和维护分散，因此不采用。

### 2. TypeScript 共享根路径解析与 dotenv 解析

`execution` 以其 package root 的父目录作为组件/仓库根，集中提供同步合并和单变量异步读取。`.env` 先加载、`.env.local` 后覆盖，已有进程环境保持不变；显式 CLI 参数仍具有最高优先级。

该规则同时适用于源码仓与组件目录：源码中 package root 是 `execution/`，组件中 package root 是 `runtime/`。产品组件默认不存在环境文件，因此自然使用 Host 进程环境。

### 3. Python 包不内置 dotenv 文件搜索

Agent 与 Record 保持进程环境契约。源码命令通过 `uv run --env-file .env.local` 将根配置注入 Python，Review 则由已加载根配置的 Node 进程传递环境。

让 wheel 自动向父目录搜索 `.env` 会把源码布局假设带入产品运行，因此不采用。

### 4. 不自动改写本地密钥文件

代码变更只提供根 example 和读取路径。现有被忽略的本地文件不进入提交；开发者将其值合并到根 `.env.local` 后即可删除子目录文件。

## Risks / Trade-offs

- [已有本地配置仍位于子目录] → 启动时不再读取旧位置，文档明确根文件路径并保留进程环境覆盖能力。
- [组件根可能由 Host 放置普通 `.env`] → 进程环境优先且组件构建拒绝打包环境文件；Host 产品应只注入进程环境。
- [多个 TypeScript 模块再次出现独立读取逻辑] → 环境根和解析由共享模块提供，并用优先级测试覆盖所有消费者。

## Migration Plan

1. 增加根 `.env.example` 和 TypeScript 共享环境读取模块。
2. 切换数据根、录制根、Python Worker 与 Midscene 环境加载。
3. 更新测试、Review 提示和文档，删除子工程 examples。
4. 开发者把本地子目录变量合并到根 `.env.local`；回滚时可将对应变量重新放回各子目录文件。
