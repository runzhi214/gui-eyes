# 多模态分诊链活体验证（2026-11-26）

背景：主会话模型 `glm-5.3` 无图像输入能力（`read_image` 报 "model does not declare image input"）。
目标：验证「文本会话 → subagent(多模态路由) → mcp__gui-eyes__gui_shot 截图 → read_image 判读 → 结论回流」整链。

## 部署路由事实（本机 dsh 0.2.2-rc.5，`list_subagent_models` 实调）

- provider id：`baidu`（显示名 opengw——显示名改名不改 id；route 用 id 组）
- 授权模型 4 个：`glm-5.3` / `glm-5.3-flash` / `deepseek-v4-pro-0813` / `deepseek-v4.1-flash-1017`

## 两次派发实测

| 尝试 | route | gui_shot | read_image | 结论 |
|---|---|---|---|---|
| vision-triage-verify | baidu/deepseek-v4-pro-0813 | ✅（settings-vision-verify-1795687826077.png） | ❌ "does not declare image input" | 同 provider 下并非所有 model 都收图——候选要试 |
| vision-try2 | baidu/deepseek-v4.1-flash-1017 | （复用上图） | ✅ 1440×900 真实读入，PIL 1.6× 放大复核 | **链路打通** |

vision-try2 判读结论（证明读图真实生效）：设置面板正常打开；7 个标签页（通用设置/模型/内置插件/Agent预设/桌宠配置/插件市场/工作区工具集）图标齐全；通用设置 9 项控件值逐项读出（权限/语言/外观/字号/步骤展示等）；无布局错位、图标缺失、文字重叠；「快捷键」行贴底属右栏可滚动常态，非缺陷。

## 踩坑记录（已写进 skill 指导链）

1. `list_subagent_models` 无参返回形如 `baidu — opengw`：id — 显示名，勿把显示名当 model 组 route。
2. `provider`+`model` 必须成对传（子代理工具契约）。
3. 许可清单（subagent-model-selection）之外的 route 一律 "not allowed for this Session"——枚举给出的就是全部可选项。
4. **选模型必须选支持多模态的**（用户拍板口径）：`deepseek-v4-pro-0813` 不是多模态模型，派发成功也读不了图；本部署 `deepseek-v4.1-flash-1017` 实测收图。枚举清单不含能力标记，按多模态名字约定优先选、试错兜底。

## 产物

- 截图：`shots/2026-11-26/settings-vision-verify-1795687826077.png`
- 指导链落点：`src/server/instructions.js`（MCP server instructions，随连接进 system prompt）+ `skills/gui-verification/SKILL.md` 多模态分诊段（双写同口径）
