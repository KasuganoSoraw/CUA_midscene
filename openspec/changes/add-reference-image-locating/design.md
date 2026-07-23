## Context

录制器当前从动作前画面生成全屏截图和 `256×256` 带红叉 crop。红叉让 trace 模型知道用户点击点，却遮挡目标真实外观。Midscene 图片 prompt 不把参考图中心解释为点击坐标，而是结合参考图、文字 prompt 和当前屏幕截图做语义定位，返回 bbox 或 point，Tap 再点击定位结果中心。

任务长期事实源仍是原生 `task.yaml`，`source/` 保留只读录制证据。该变更横跨 Python 录制处理、trace 模型输出、TypeScript 转换器、resolved YAML 和整体 aiAct 投影。

## Goals / Non-Goals

**Goals:**

- 在不改变现有 trace crop 的前提下，为点击类步骤生成干净、紧凑、目标居中的参考图。
- 让 trace 模型只判断该步骤是否值得使用视觉参考，不让模型生成资产路径。
- 将选中的参考图确定性转换为 Midscene 原生 `locate.images`。
- 让逐步 YAML 与录制任务整体 aiAct 都能消费相同参考图。
- 保持任务资产可读、可移动，并在路径或图片无效时显式失败。

**Non-Goals:**

- 不实现像素级 OpenCV 模板匹配、图像相似度阈值或坐标回放。
- 不自动识别控件 bbox，不根据单一业务关键词决定是否使用参考图。
- 不为 input、keyboard、wait 添加图片参考。
- 不开发前端裁剪器或人工框选界面。
- 不把 Base64 写入 canonical YAML 或 trace。

## Decisions

### 1. 保留标注 crop，新增干净 reference patch

点击和双击步骤继续生成现有 `*.crop.jpg`，尺寸、红叉和 trace 输入行为不变；同时从红叉绘制前的同一帧生成 `*.reference.png`。第一版 reference patch 固定为 `96×96`、目标点居中、PNG 无损保存，并在 processed log 中增加 `screenshot_reference`。

选择双资产而不是直接移除红叉，是因为 trace 生成需要点击点证据，而 Midscene 匹配需要目标真实外观。固定尺寸比假装从单个点击点推断控件 bbox 更诚实，也便于后续以真实业务样本比较 `64/96/128`。

### 2. trace 使用可选执行建议而不是“小图标分类”

click/doubleClick operation 可选输出 `useReferenceImage: true`。字段缺失或 false 表示不使用。模型只在目标缺少稳定文字、主要依赖形状/颜色/企业图形，并且纯文字 prompt 仍易混淆时设置该字段。

不使用 `isSmallIcon`，因为控件尺寸与是否需要视觉参考不是同一事实。模型也不输出路径、图片名、Base64、置信度或兜底动作。

### 3. 转换器从 processed log 绑定图片

trace 与 processed log 继续按长度和顺序一一对应。若 operation 请求视觉参考，转换器读取对应 processed step 的 `screenshot_reference`，验证其为任务 `source/` 下的安全相对路径，并生成：

```yaml
- aiTap:
  locate:
    prompt: 点击目标；目标外观应匹配参考图“step-003-target”正中央的主要图标
    images:
      - name: step-003-target
        url: source/screenshots/10.854s.reference.png
```

图片名由 step ID 确定，转换器向原 operation prompt 追加明确的 matching 语义。请求图片但 processed log 缺少路径、路径越界或文件不存在时转换失败，不回退到字符串 `aiTap`。

### 4. canonical YAML 相对、resolved YAML 绝对

`task.yaml` 保存相对于任务根目录的本地图片路径，保持任务包可移动。resolver 在输入占位符解析后遍历 Midscene user prompt 的 `images[].url`：HTTP(S) 与 data URL 原样保留，本地相对路径解析为任务根目录下的绝对路径并验证文件存在；绝对路径仍验证存在。解析结果仅进入 `resolved-task.yaml`。

不使用 Base64 作为长期资产，因为它会破坏 YAML 可读性和前端预览；Midscene 在模型调用边界自行读取本地文件并构造多模态请求。

### 5. 整体 aiAct 汇总图片 prompt

录制任务整体 aiAct 投影同时生成最终文字步骤和去重后的 `images`。每个图片步骤的文字继续引用其图片名，临时 `ai` action 使用 Midscene 原生 `{prompt, images}` 结构。重复图片名映射到不同 URL、非法图片 prompt 或不支持动作时显式失败。

不把图片描述转写为纯文本，也不在 aiAct 失败后切换逐步 runner。

## Risks / Trade-offs

- [固定 `96×96` 可能截断较大控件或包含相邻图标] → 第一版只对模型明确建议的难描述图标启用，并保留配置入口和真实样本测试，后续再决定是否引入多尺寸或人工框选。
- [弱模型可能错误设置 `useReferenceImage`] → 该字段只是任务生成建议，canonical YAML 可由人或 Agent 按既有确认协议校准；转换过程不使用关键词兜底。
- [参考图中心不是 Midscene 原生协议] → reference patch 保证目标居中，并在 prompt 中明确“正中央的主要图标”；匹配仍由 Midscene 语义定位完成。
- [相对路径解析可能访问任务目录外文件] → 转换器和 resolver 对录制生成路径限制在任务根目录，路径越界立即失败。
- [整体 aiAct 多图增加模型成本] → 只汇总被明确选择的步骤图片，不为每个点击默认附图。

## Migration Plan

当前处于开发探索阶段，不迁移或兼容既有任务。新录制重新生成 processed log、trace 和 task；旧任务保持原样，不会被自动补图。回滚时删除新增字段和生成逻辑即可，原有 `*.crop.jpg` 与纯文本 YAML 路径未被覆盖。

## Open Questions

- `96×96` 是否适合华为网管界面，需要用真实图标样本比较定位成功率后确认。
- 后续前端是否允许用户替换 reference patch 或手工调整裁剪范围，本轮不实现。
