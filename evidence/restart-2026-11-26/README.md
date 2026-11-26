# dsh 重启活体验证(2026-11-26)

## 结论

1. **持久 cookie 跨 dsh 重启有效**:重启后 `gui_open` 返回 `auth_mode=cookie`,探测未撞认证墙,token 文件全程未被读取——§4.4「重启后无需重贴 URL」的 cookie 路径成立。
2. **M2.1 修复字段已实达 agent**:重启后的新会话工具清单为 7 条新描述(含 force / degraded / plain 必填 / SAFETY_NOTE),且描述承诺的每个行为都实测通过(见 [restart-verify.json](./restart-verify.json))。

## 关键前提(如实记录)

- 验证前用户重启了 dsh,**并用终端新 URL 重写了 `~/.dsh-gui-token`**。
- 该前提不影响「cookie 跨重启有效」的结论:`auth_mode=cookie` 由代码路径保证——`ensureDshCookieAuth` 先探测页面,未撞墙即返回,不读 token 文件;token 文件只在重铸路径(`token-bootstrap`)参与。
- 重贴 token 的价值在另一层:重启后旧 launch token 已死,重贴让 token 文件对**下一次** cookie 失效时的重铸保持可用。两层各自成立,互不矛盾(即 #7 已澄清的口径)。

## 当日两路径覆盖情况

| 路径 | 证据 | 时间 |
|---|---|---|
| 重铸路径(401 → token → 303 → cookie 落盘) | [evidence/m2/new-session-verify.json](../m2/new-session-verify.json)(`auth_mode=token-bootstrap`) | 同日 15:08 +08:00 |
| cookie 存活路径(重启 → 直连) | [restart-verify.json](./restart-verify.json)(`auth_mode=cookie`) | 同日 16:31–16:39 +08:00 |

未覆盖:「token 文件持死值 + cookie 失效」的重铸失败场景(用户已刷新 token,构造该场景需再重启一次 dsh,收益低)。

## 与 issues-2026-11-26 的关系

[evidence/issues-2026-11-26/issue-drive.json](../issues-2026-11-26/issue-drive.json) 是 #1–#8 修复的**脚本化**验收(spawn 新代码 MCP server 逐条断言);本目录是其**无法脚本化的补充**——dsh 重启这个动作只能发生在真实环境,记录为会话观测。两者共同构成 M2.1 的完整验收证据。

## 验证明细

逐条工具调用与原样返回见 [restart-verify.json](./restart-verify.json):cookie 直连、`not-found` 失败分类、`total_length`/`truncated` 截断标记、`force` 强制重开、截图日期子目录(`shots/2026-11-26/`,文件本体不入库)。
