## ADDED Requirements

### Requirement: 定位参考图通过普通界面管理
本地 review 页面 SHALL 将录制阶段可用的 `screenshot_reference` 与 YAML 已绑定的 `locate.images` 统一呈现为“定位参考图”，并 SHALL 允许用户在受支持的可写步骤中通过普通界面决定单张录制定位参考图是否参与执行定位，而无需直接编辑 JSON。

#### Scenario: 展示单张定位参考图
- **WHEN** 当前步骤存在一张录制定位参考图或一张已绑定定位参考图
- **THEN** 页面 SHALL 使用“定位参考图”作为页签和区域名称
- **AND** 页面 SHALL NOT 显示“目标小图 1”或其他单图数量描述
- **AND** 页面 SHALL 说明该图片帮助 Midscene 识别目标外观且不表示固定点击坐标
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
- **AND** 页面 SHALL 提示该步骤需要通过高级 JSON 维护多图配置
