# 工作台等待配置与运行时输入开关实施计划

> 执行方式：使用 executing-plans 在当前 `codex/workbench-ucd` 分支逐项执行，使用 test-driven-development 与 verification-before-completion 验证。

**目标：** 按 UCD 素材展示等待配置，并以可访问开关控制输入文本参数化。

**架构：** 保持 `App.vue` 的编辑模型、浏览器草稿和任务保存链路。等待字段仅调整布局与说明；`ReviewSwitch.vue` 管理布尔状态展示和更新事件，不依赖执行器。

**技术：** Vue 3、TypeScript、本地 CSS、Node 测试运行器、Vue SFC 编译器。

## 文件职责

- `execution/review/web/src/App.vue`：等待字段布局、字段说明、开关绑定。
- `execution/review/web/src/components/ReviewSwitch.vue`：可访问开关。
- `execution/review/web/src/components/ReviewSelect.vue`：使用 UCD 下拉箭头。
- `execution/review/web/src/assets/ucd/`：按 HTML 引用映射的 SVG。
- `execution/review/web/src/i18n.ts`：等待触发条件、等待时长及最长等待时间说明。
- `execution/review/web/src/review.css`：等待字段两列和窄屏布局。
- `execution/tests/review/workbench-controls.test.ts`：布局契约、SVG 引用和实际开关渲染与事件测试。
- `execution/tests/review/step-editor.test.ts`：等待字段与输入参数化契约。
- `execution/tests/all.test.ts`：注册测试。

## 任务 1：等待配置与 SVG

- [x] 添加等待布局与文案断言，执行 `npx.cmd tsx --test tests/review/workbench-controls.test.ts`，确认断言失败。

```ts
assert.match(app, /class="wait-fields wide"/);
assert.equal(translate('zh-CN', 'review.waitCondition'), '等待触发条件');
assert.equal(translate('zh-CN', 'review.timeout'), '等待时长（毫秒）');
assert.match(translate('zh-CN', 'review.timeoutHelp'), /最长/);
```

- [x] 按 HTML 引用复制 `11_22842.svg` 为 `action-info.svg`，`11_22894.svg` 为 `wait-info.svg`，`13_3913.svg` 为 `select-arrow.svg`；核对搜索、新增、拖拽、删除和定位图 SVG 的实际对应关系，仅替换视觉不一致的素材。
- [x] 在等待操作中使用以下结构，保持 `editor.waitCondition`、`editor.timeoutMs` 的绑定、只读条件和最小值：

```vue
<div class="wait-fields wide">
  <label><span class="field-label">{{ t('review.waitCondition') }}<img :src="waitInfoIcon" :title="t('review.waitConditionHelp')" alt="" /></span>
    <textarea v-model="editor.waitCondition" rows="3" :readonly="busy || !writable || advancedEditing" :placeholder="t('review.waitPlaceholder')"></textarea>
  </label>
  <label :title="t('review.timeoutHelp')">{{ t('review.timeout') }}
    <input v-model.number="editor.timeoutMs" type="number" min="1" step="1000" :readonly="busy || !writable || advancedEditing" />
  </label>
</div>
```

- [x] 使用 `grid-template-columns: repeat(2, minmax(0, 1fr))` 和 `gap: 16px`；窄内容区使用单列。将 UCD 箭头放入选择器，展开时旋转，保持选项与键盘逻辑。
- [x] 添加等待模型往返测试：`sleep` 与 `aiWaitFor.timeout` 分别保持数值；执行相关测试、类型检查与前端构建。
- [x] 仅暂存本任务文件，执行 `git diff --cached --check`，提交“对齐等待配置布局与工作台图标素材”。

## 任务 2：运行时输入开关

- [x] 添加失败测试：输入区域必须使用 `ReviewSwitch`；编译真实 Vue SFC 并断言 `role="switch"`、名称、布尔 `aria-checked`、原生 `disabled` 和点击更新事件。
- [x] 创建 `ReviewSwitch.vue`，使用以下状态接口和点击规则：

```ts
const props = defineProps<{ modelValue: boolean; disabled?: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
function toggle(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue);
}
```

- [x] 模板使用原生 `button type="button" role="switch"`，绑定 `aria-label`、`aria-checked`、`disabled` 和 `@click="toggle"`。利用原生按钮的 Enter/Space 行为，不重复注册键盘切换事件。
- [x] CSS 使用 38×20 轨道、16 像素圆形滑块、32 像素点击区；开启颜色 `#0067d1`，关闭中性灰，分别提供 focus-visible、disabled 和 reduced-motion 样式。
- [x] 将参数化复选框替换为“文字 + 右侧开关”，使用 `v-model="editor.parameterized"` 和原有禁用表达式。保留条件字段、草稿与序列化逻辑。
- [x] 验证开关两态、禁用时不发事件、往返切换后参数字段仍保留。运行 `npm.cmd run typecheck`、相关测试与 `npm.cmd run build:web`。
- [x] 启动本地预览，确认静态资源与录制列表接口可用；不保存或清空用户的任务草稿。
- [ ] 在浏览器核对等待布局、开关和 SVG 的视觉效果。
- [x] 显式暂存本任务路径并提交“使用运行时输入开关控制任务参数”。不推送、不合并。
