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
| iframe 内文本/元素 | 断言或点击都带 `frame: "<iframe 选择器>"`(`textVisible: {text: X, frame: "#frame1"}`) |
| Shadow DOM 内文本 | `textVisible` 可命中(getByText 穿透 open shadow);`gui_dom` 读不到 shadow 文本——断言用 gui_assert,别用 gui_dom 误判「页面没有」 |
| 新标签页(target=_blank) | `gui_open` 报告的 `tabs` 是总页数;`gui_click/gui_type/gui_dom/gui_shot/gui_assert` 传 `tab: 1` 观测新页 |
| 视口外内容 | 文本断言不受视口限制;截图要整页传 `fullPage: true` |

**关键口径**:`textVisible` 与点击同引擎(子串、大小写不敏感、只计可见元素、穿透 open shadow)。「工具看不见」时先查是否踩边界,再下「页面没有」的结论。

## 已知坑

- `gui_type` 对富文本编辑器(ProseMirror 类)`fill("")` 清空无效——不要用空串清空,填入替换内容。
- `gui_click` 的 text 非精确、多匹配点 DOM 序第一个——响应 `matches` 字段暴露命中数,`matches > 1` 时换更精确的定位或 `exact: true`。
- MCP 工具描述与清单是会话启动时快照;引擎更新后需新会话才见新工具面。

## target 选择

- 验证本 dsh GUI:默认 `target: dsh-web`(30 天 cookie 自动续)。
- 采集任意站点:`target: plain, baseUrl: <必填>`;自签 HTTPS/代理/UA 等启动参数经 `GUI_EYES_LAUNCH_JSON` 环境变量传给引擎进程;basic auth 经 `GUI_EYES_HTTP_CREDS=user:pass`。

## 安全注意

GUI 操作以真实用户身份生效,**不受会话权限模式(只读/读写)约束**——能点发送、能确认弹窗。验证链里只做与任务相关的操作,高影响动作(发送消息/删除确认)先向用户确认。
