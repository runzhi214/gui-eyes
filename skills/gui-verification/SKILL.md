---
name: gui-verification
description: 用 gui-eyes MCP 工具(mcp__gui-eyes__*)验证页面、验收 UI 改动、做回归测试——典型验证链、可见性边界与已知坑。当任务说「验证页面/验收/回归测试/UI 检查/截图看看/点开看看/E2E」,或改完前端代码需要自己确认页面效果时使用。
whenToUse: |
  改完代码需要自己验证页面效果;用户要求验收 UI 改动、回归测试、截图确认、点开页面看看;
  需要以 agent 身份操作浏览器完成「打开→交互→断言→留证」闭环。
---

# gui-verification:用 gui-eyes 验证页面

## 工具面

`mcp__gui-eyes__*` 七个工具:`gui_open` / `gui_click` / `gui_type` / `gui_shot` / `gui_dom` / `gui_assert` / `gui_run`。会话跨调用保活(同 baseUrl+auth 复用);DSH cookie 失效自动重铸。

## 典型验证链

```
gui_open → gui_click / gui_type 交互 → gui_assert 断言 → gui_shot 截图留证
```

- 第一步永远 `gui_open`(默认 target dsh-web 即本 GUI;采集其它站点用 `target: plain` + 必填 baseUrl)。
- 验证「点完之后对不对」用 `gui_assert`(textVisible/count/checked 等规则),不要只看 click 的 ok:true——那只证明点了,不证明结果。
- 最后 `gui_shot` 留证,路径可直接交读图工具。

## 可见性边界(先读,防误判)

| 你想观测的 | 正确做法 |
|---|---|
| 主文档文本 | `gui_dom` / `textVisible` 断言 |
| iframe 内文本/元素 | 断言或点击都带 `frame: "<iframe 选择器>"`(`textVisible: {text: X, frame: "#frame1"}`);读文本用 `gui_dom {frame: "#frame1"}` |
| Shadow DOM 内文本 | `textVisible` 断言可命中(getByText 穿透 open shadow);读文本用 `gui_dom {includeShadow: true}`(主文档+shadow 合并,响应带 shadow_segments) |
| 新标签页(target=_blank) | `gui_open` 报告的 `tabs` 是总页数;`gui_click/gui_type/gui_dom/gui_shot/gui_assert` 传 `tab: 1` 观测新页 |
| 视口外内容 | 文本断言不受视口限制;截图要整页传 `fullPage: true` |

**关键口径**:`textVisible` 与点击同引擎(子串、大小写不敏感、只计可见元素、穿透 open shadow)。「工具看不见」时先查是否踩边界,再下「页面没有」的结论。

## 已知坑

- `gui_click` 的 text 非精确、多匹配点 DOM 序第一个——响应 `matches` 字段暴露命中数,`matches > 1` 时换更精确的定位或 `exact: true`。
- MCP 工具描述与清单是会话启动时快照;引擎更新后需新会话才见新工具面。每个响应带 `engine_version` 尾字段——与引擎最新版本对照不符即开新会话(漂移自检,0.6.1 起)。
- `gui_type` 对 contenteditable 富文本(ProseMirror 类)自动走键盘路径(0.6.0 起):空串=纯清空,普通输入框照旧 fill——无需再绕「不用空串清空」的旧坑。

## 判读分流(先读:别把断言能答的问题送去读图)

- 「**页面上有没有文字 X**」→ `gui_assert` 的 textVisible(穿透 shadow、不受视口限制、秒回)——**勿读图**
- 「**某容器下有没有节点/崩溃锚点**」→ `gui_dom {selector: "..."}` 看 outerHTML
- 「**任意运行时状态**(模块表/全局变量/DOM 结构)」→ `gui_dom {eval: "JS 表达式"}`
- 「**布局/样式对不对**、视觉效果」→ 才需要截图判读;目标元素明确时用 `gui_shot {selector}` 裁剪,提示词框定「右下角」之类的歧义自然消失
- 「**瞬态 UI**(toast 存活窗短)」→ `gui_shot {wait: {text|selector, timeoutMs}}` 先等命中再截,别 sleep+盲抓

## 多模态分诊(文本会话要看图时必读)

当前会话模型**没有图像输入能力**时(调读图工具报 "does not declare image input" 之类):

- **截图/留证/交用户**——不需要分诊,任何会话都能做(`mcp__gui-eyes__gui_shot` 后把路径给用户/写报告)。
- **要判读截图内容**(UI 验收:确认按钮状态、布局对不对、图表数值)——**不要自己猜图**,起多模态子代理:
  1. 先 `list_subagent_models` 枚举本部署可用的路由(无参返回 provider 清单;注意 provider **id** 可能与显示名不同,route 用 id 组;再按 provider 枚举它的 model);
  2. **选模型必须选支持多模态的**——deepseek-v4-pro 等纯文本模型即使能派发也读不了图;多模态模型按名字约定优先(如 deepseek-v4.1-flash 属多模态系);`subagent` 起子代理时 provider+model 显式传该路由(不传则继承当前文本会话,读不了图);
  3. 子代理任务写清:`用 mcp__gui-eyes__gui_shot 截 <目标页/元素> 并用读图工具判读 <验收点>`,附会话上下文(刚做的改动、要确认什么);
  4. 子代理完成通知带回结论,父会话汇总结论,不搬原图。若子代理报读图失败,换枚举出的下一个多模态候选重派。

主会话是多模态模型时,直接自己 `gui_shot` + `read_image`,无需分诊。

## target 选择

- 验证本 dsh GUI:默认 `target: dsh-web`(30 天 cookie 自动续)。
- 采集任意站点:`target: plain, baseUrl: <必填>`;自签 HTTPS/代理/UA 等启动参数经 `GUI_EYES_LAUNCH_JSON` 环境变量传给引擎进程;basic auth 经 `GUI_EYES_HTTP_CREDS=user:pass`。

## 安全注意

GUI 操作以真实用户身份生效,**不受会话权限模式(只读/读写)约束**——能点发送、能确认弹窗。验证链里只做与任务相关的操作,高影响动作(发送消息/删除确认)先向用户确认。
