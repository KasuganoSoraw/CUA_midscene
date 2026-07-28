## Context

参考图定位链路已经把 `96×96` 干净图片保存在任务 `source/screenshots/`，并在点击/双击步骤中生成 Midscene 原生结构：

```yaml
- aiTap: null
  locate:
    prompt: 点击目标；目标外观应匹配参考图
    images:
      - name: step-012-target
        url: source/screenshots/26.861s.reference.png
```

复核应用当前只从 processed log 组合全局图与带红叉局部图；语义编辑器也只把单一字符串 `aiTap`/`aiDoubleClick` 视为标准动作。因此参考图既不可见，带图步骤也只能通过高级 JSON 维护。canonical 事实源仍是 `task.yaml`，`source/` 仍是只读资产目录。

## Goals / Non-Goals

**Goals:**

- 让用户在步骤上下文中区分并查看全局录制图、带点击标记的局部图和执行定位参考图。
- 让带 `locate.images` 的点击/双击步骤继续使用普通语义表单编辑 prompt，并无损保留图片引用。
- 让草稿内的高级 JSON 修改能立即反映到参考图展示。
- 继续把本地文件读取限制在已解析任务的 `source/` 内。

**Non-Goals:**

- 不提供上传、替换、裁剪或重新生成 reference patch 的 UI。
- 不改变 `task.yaml` 的 Midscene 原生结构，不复制图片路径到 `task.json`。
- 不允许通过复核服务读取任务目录外文件。
- 不为 input、keyboard、wait 引入参考图语义表单。

## Decisions

### 1. 从步骤 Flow 派生参考图，而不是建立第二份绑定

服务端在组合 `ReviewStep` 时把 processed step 的可选 `screenshot_reference` 投影为录制证据中的干净目标小图，同时解析点击类动作的 `locate.images` 并返回 `referenceImages`，其中保留 `name` 与 canonical `url`。前者表示可用资产，后者表示 YAML 已实际绑定；两者都只是既有事实源的只读投影，不写入 manifest，也不参与 revision 之外的新持久化。

选择服务端派生而不是仅在 Vue 内解析，是为了集中处理路径安全、使初次加载和草稿重建共享相同规则，并让 API/服务测试直接验证契约。

### 2. 普通表单将图片作为点击动作模型的一部分

`StepEditorModel` 增加参考图片数组。解析器同时接受：

- `{ aiTap: "目标描述" }`
- `{ aiTap: null, locate: { prompt, images } }`
- 对应的 `aiDoubleClick` 形式

构建器在图片数组为空时继续生成字符串简写；存在图片时生成 `action: null + locate` 结构。这样修改目标描述只改变 `locate.prompt`，图片名称与 URL 不会丢失。图片列表暂不提供普通表单增删，仍可通过高级 JSON显式维护。

### 3. 参考图作为独立执行资产展示

证据查看器保留“全局图/局部图”录制证据切换，并在步骤存在 `screenshot_reference` 或 YAML 图片绑定时增加图片入口。只有 YAML 已绑定时标记为“执行定位参考”；只有录制目标小图时明确标记“YAML 未绑定”。图片以紧凑卡片呈现名称和路径，避免用户把它误解为点击坐标或普通录制 crop。

步骤切换时默认展示带点击标记的局部图，因为它是面向人类复核最直接的点击证据；没有局部图时依次回退到全局图和参考图。参考图是否被 YAML 绑定不改变该默认顺序。

步骤列表使用独立的图片标识提示该步骤带执行参考图；录制证据圆点语义保持不变。

### 4. 本地图片复用 evidence API，远程和 data URL 不扩权

canonical URL 位于 `source/` 时，前端通过现有 evidence API 读取，沿用 scene/task 解析与 source 边界检查。`data:` URL 可直接预览；HTTP(S) URL 保留为外部 URL。其他本地路径不会产生可预览地址，并在服务组合时显式拒绝越出 `source/` 的引用。

不新增通用 asset API，因为当前录制生成路径均在 `source/`，扩大到整个任务目录没有产品收益。

### 5. 无证据步骤使用中性占位图

服务端和前端草稿重建都不再把最近一个录制步骤复制为 `contextEvidence`。步骤没有自己的 `stepBindings`，或者绑定步骤没有全局图和局部图时，页面展示统一的 Vue/SVG 占位图，并说明该步骤没有独立录制截图。

选择占位图而不是沿用上一张截图，是因为证据必须保持步骤身份一致；即使标记“上下文参考”，上一张截图仍容易被人误读为当前步骤的真实状态。若当前步骤另有 canonical `locate.images`，参考图标签仍独立可用，但不替代默认的录制证据占位状态。

## Risks / Trade-offs

- [高级 JSON 可写入前端不能预览的外部或非法 URL] → 应用高级 JSON 后仍通过现有任务校验；本地引用必须位于 `source/`，不可预览项展示明确错误状态。
- [参考图与录制 crop 同时存在导致概念混淆] → 使用独立标签和说明文字，明确前者供执行定位，后者用于解释原始点击点。
- [语义表单重建改变 YAML 简写形式] → 仅当存在图片时生成完整 `locate` 结构；无图步骤继续保持原有简写，带图步骤语义与 Midscene 契约不变。
- [多个 reference images 占用空间] → 使用缩略卡片和可滚动容器，不放大全部图片到全宽证据画布。
- [移除上下文截图后新增步骤缺少视觉线索] → 使用明确占位图提示无证据；用户仍可查看相邻步骤或为该步骤配置执行参考图，但页面不伪造证据归属。

## Migration Plan

该变更只扩展 review API 的步骤投影和前端解析，不修改 canonical 资产。旧任务不含 `locate.images` 时界面与生成 YAML 保持原状；回滚代码后 YAML 仍可由高级 JSON和执行器消费。

## Open Questions

- 后续是否允许用户从现有 `source/` 资产中替换 reference patch，需要结合真实复核流程另行设计；本轮只做展示和无损往返。
