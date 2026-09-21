# Spec Delta

## ADDED Requirements

### Requirement: 普通工作台使用面向用户的产品语言
本地 review 应用 SHALL 在普通工作台模式中使用围绕录制流程、任务检查和运行任务的用户语言，并 SHALL 将执行引擎名称、Agent Tool 协议、原始任务资产以及 invocation 诊断限制在开发模式中。

#### Scenario: 用户打开普通工作台
- **WHEN** 用户在未启用开发模式的情况下打开工作台
- **THEN** 页面 SHALL NOT 使用 CUA、Midscene、canonical、Tool Calling 或 task.yaml/task.json 作为普通功能的名称或说明
- **AND** 页面 SHALL 使用能够直接说明用户目标的录制、任务检查和运行文案
- **AND** 页面 SHALL NOT 展示原始任务资产编辑器、开发调用状态或 Agent 测试入口

#### Scenario: 开发者打开开发模式
- **WHEN** 开发者通过受支持的开发参数打开工作台
- **THEN** 页面 MAY 展示 Agent 测试入口、原始任务资产和调用诊断
- **AND** 普通工作流的主要名称与说明 SHALL 继续采用面向用户的产品语言

#### Scenario: 配置缺失需要排查
- **WHEN** 工作台无法访问必需的本地目录或运行配置
- **THEN** 页面 SHALL 使用当前语言说明问题和处理步骤
- **AND** 页面 MAY 以代码形式展示完成配置所必需的环境变量名、文件位置和命令

### Requirement: 工作台支持中文与英文切换
本地 review 应用 SHALL 提供简体中文和英文界面，并 SHALL 让用户在不重新载入页面或丢失当前工作状态的情况下切换语言。

#### Scenario: 用户切换界面语言
- **WHEN** 用户在工作台中选择简体中文或英文
- **THEN** 当前页面可见的导航、标题、操作、状态、空态、校验提示和帮助文案 SHALL 立即使用所选语言
- **AND** 当前选择、表单草稿、未保存修改和运行状态 SHALL 保持不变
- **AND** 页面 SHALL 保存该语言选择供后续访问使用

#### Scenario: 工作台确定初始语言
- **WHEN** 工作台首次初始化
- **THEN** 有效的 URL 语言参数 SHALL 优先于已保存语言
- **AND** 已保存语言 SHALL 优先于浏览器语言
- **AND** 中文浏览器语言 SHALL 选择简体中文，其他浏览器语言 SHALL 选择英文

#### Scenario: 页面元数据跟随语言
- **WHEN** 工作台初始化或用户切换语言
- **THEN** 文档语言、页面标题和面向用户的日期格式 SHALL 与当前语言一致

### Requirement: 录制流程自动准备屏幕选择
本地 review 应用 SHALL 在用户进入录制流程时自动检测可录制屏幕，并 SHALL 将屏幕检测呈现为录制准备过程而不是要求用户理解并触发截图操作。

#### Scenario: 首次进入录制流程
- **WHEN** 用户打开录制流程且录制器未处于准备、录制或停止状态
- **THEN** 页面 SHALL 自动开始检测可录制屏幕并展示明确的检测中状态
- **AND** 检测完成后 SHALL 展示屏幕预览并默认选择主屏幕，若没有主屏幕标识则选择第一个屏幕
- **AND** 用户 SHALL NOT 需要先点击获取截图才能准备录制

#### Scenario: 用户重新检测屏幕
- **WHEN** 自动检测失败、屏幕配置发生变化或用户主动要求刷新
- **THEN** 页面 SHALL 提供当前语言对应的“重新检测屏幕”操作
- **AND** 操作期间 SHALL 展示检测中状态并防止重复触发

#### Scenario: 录制流程已经处于活动状态
- **WHEN** 用户打开录制流程时录制器处于准备、启动、录制或停止状态
- **THEN** 页面 SHALL 优先展示当前录制状态和停止操作
- **AND** 页面 SHALL NOT 发起新的屏幕检测

## MODIFIED Requirements

### Requirement: 定位参考图通过普通界面管理
本地 review 页面 SHALL 将录制阶段可用的 `screenshot_reference` 与 YAML 已绑定的 `locate.images` 统一呈现为“定位参考图”，并 SHALL 允许用户在受支持的可写步骤中通过普通界面决定单张录制定位参考图是否参与执行定位，而无需直接编辑 JSON。

#### Scenario: 展示单张定位参考图
- **WHEN** 当前步骤存在一张录制定位参考图或一张已绑定定位参考图
- **THEN** 页面 SHALL 使用当前语言对应的“定位参考图”作为页签和区域名称
- **AND** 页面 SHALL NOT 显示“目标小图 1”或其他单图数量描述
- **AND** 页面 SHALL 说明该图片帮助系统识别目标外观且不表示固定点击坐标
- **AND** 当前步骤存在局部录制图时 SHALL 继续默认展示局部图

#### Scenario: 将录制定位参考图用于定位
- **WHEN** 可写的标准 click 或 doubleClick 步骤存在一张未绑定的录制定位参考图，且用户点击“用于定位”
- **THEN** 页面 SHALL 将该图片作为唯一候选加入当前步骤草稿的 `locate.images`
- **AND** 页面 SHALL 保留目标描述与动作前等待时间
- **AND** 高级 JSON、变更对比和绑定状态 SHALL 立即联动
- **AND** 页面 SHALL NOT 在用户确认写入前修改磁盘资产

#### Scenario: 取消使用已绑定定位参考图
- **WHEN** 可写的标准 click 或 doubleClick 步骤只绑定一张定位参考图，且用户点击“取消使用”
- **THEN** 页面 SHALL 从当前步骤草稿中移除 `locate.images`
- **AND** 页面 SHALL 保留目标描述、动作前等待时间和 `source/` 中的图片文件
- **AND** 高级 JSON、变更对比和绑定状态 SHALL 立即联动

#### Scenario: 只读或不支持的步骤
- **WHEN** 当前任务为 builtin、步骤不是标准 click/doubleClick、页面处于高级编辑或保存忙碌状态
- **THEN** 页面 SHALL 继续展示可用的定位参考图和当前绑定状态
- **AND** 页面 SHALL 禁用绑定操作并说明不可操作原因

#### Scenario: 已有 YAML 绑定多张定位参考图
- **WHEN** 当前步骤的 canonical `locate.images` 包含两张或更多图片
- **THEN** 页面 SHALL 完整展示并无损保留全部图片引用
- **AND** 普通界面 SHALL NOT 提供会将多图静默替换、压缩或全部移除的单图绑定操作
- **AND** 页面 SHALL 提示该步骤需要通过开发模式中的高级编辑器维护多图配置
