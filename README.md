# gui-eyes 通用 GUI 采集引擎

> **设计锚点**：根目录 [REQUIREMENTS.md](./REQUIREMENTS.md)（2026-11-25 定稿，D1–D10 已拍板）是唯一交接锚点，开工先读它。本 README 是新用法索引。
>
> 给 agent 装上看**任意 web GUI** 的眼睛：持久鉴权会话 + 页面导航 + 截图/DOM/console/network 观测 + 断言。DSH web 是第一个内置鉴权策略，不是能力边界（`--target plain` + `auth: none` 即可采集任何页面）。
>
> 安全事实如实说明：进程内执行与原生 shell 同权（§8 红线，不假称安全）。

## 安装与依赖

```bash
pnpm install          # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 已内置于 .npmrc/pnpm 配置；浏览器复用 ~/.cache/ms-playwright 缓存，兜底 channel:'chrome'
pnpm test             # vitest 纯逻辑单测（不启浏览器、不连活 GUI）
```

playwright 精确钉死 `1.62.1`（与缓存 chromium-1234 匹配，D6 准零安装约束）。

## 用法（CLI）

```
gui-eyes run <scenario.yaml> [--base-url <url>] [--out-dir <dir>] [--timeout-scale <f>]
gui-eyes shot [--target dsh-web|plain] [--base-url <url>] [--out-dir <dir>] [--name <n>]
gui-eyes dom  [--target dsh-web|plain] [--base-url <url>] [--head <chars>]
```

- 直接跑：`node bin/gui-eyes.js run scenarios/xxx.yaml`（或 `pnpm link` 后用 `gui-eyes`）。
- baseUrl 优先级：显式参数 > `GUI_EYES_BASE_URL` > 场景声明 > `http://127.0.0.1:3080/`（该回退默认仅对 `dsh-web` 有意义；`--target plain` 必须显式给 baseUrl，缺省直接报参数错误，不会静默指向 dsh-web）。
- 输出：stdout 单个 JSON（契约 §4.3）；exit 0 成功 / 1 失败或断言未全过 / 2 未鉴权（NO_TOKEN / NO_COOKIE / TOKEN_STALE）。

### dsh-web 鉴权 bootstrap（仅 cookie 失效时需要）

把 dsh web 终端打印的完整 URL 写入 token 文件（一行），引擎自动重铸 30 天 cookie：

```bash
echo 'http://127.0.0.1:3080/?token=...' > ~/.dsh-gui-token
```

- cookie 落 `~/.cache/dsh-gui-eyes/profile`，由持久密钥签名，30 天有效且跨 dsh 重启不掉。
- **dsh 重启后不需要重贴 token**：cookie 跨重启有效。重启只是让终端打印的 launch token 轮换——只有当 cookie 本身失效、需要重铸时（命中 §4.4 五条件之一，如满 30 天），才要贴 dsh web **重启后新打印**的 URL。
- 重铸带兑付后复验：token 已死（如重启后贴的是旧 URL）时报告 `TOKEN_STALE` 结构化错误（exit 2），不再假报成功。
- token 只读、掩码、永不落盘/不回显/不进报告明文；token URL 原样使用不解析重组。

### 场景 YAML

steps + asserts 的完整 schema 见 REQUIREMENTS.md §4.2（含 2026-11-25 批准的 4 项扩展：内联 assert、`textMatches`、`checked`、`click.ifNotVisible`）。场景字眼只允许出现在 `scenarios/` 数据文件里（§8 红线）。

## 目录

- `src/core/` 机制层（target / auth / browser / primitives / observe / asserts / report / session）
- `src/scenario/` 场景装载校验 + runner；`src/cli/` CLI 壳；`src/server/` MCP server（M2 已交付，`bin/gui-eyes-mcp.js` stdio 入口）
- `mcp-register/` dsh 注册 bundle（配置-only）：`plugin_manager install_bundle` 指向本目录即可把 7 个 `mcp__gui-eyes__*` 工具注入 profile 的所有新会话
- `scenarios/` 通用示例场景（`example-plain.yaml`）；workbench 四场景已迁移至 landingzone-workbench 仓 `.dsh/gui-scenarios/`
- `tests/` vitest 纯逻辑单测；`evidence/` 活体回归证据（原脚本归档与等价对照、M1/M2 验收驱动与结果）；`shots/` 运行产物（.gitignore）

## MCP 接入（M2，已交付）

任何 dsh profile 想让 agent 用上 gui-eyes：安装 `mcp-register/` 这个配置-only bundle（`plugin_manager` `action: install_bundle`，target 为本仓 `mcp-register/` 绝对路径），重启 dsh 后**每个新会话**的工具面自动出现 `gui_open / gui_click / gui_type / gui_shot / gui_dom / gui_assert / gui_run`（`mcp__gui-eyes__*`），无需记忆、无需文档。会话跨调用保活，DSH cookie 失效自动重铸；截图默认落 `shots/<今日>/` 并返回绝对路径，可直接交读图工具。

工具面语义（2026-11-26 issue 修复后）：

- `gui_open`：同 baseUrl+auth 复用会话、不重新导航；页面已关闭/渲染崩溃自动重开；`force: true` 强制关旧重开；报告含 `degraded` 健康度。
- `gui_click` / `gui_type`：响应附命中数 `matches` 与元素文本摘要（text 默认非精确匹配、多匹配点 DOM 序第一个——歧义看 `matches` 字段）；失败按 `error: not-found | timeout | obscured | error` 分类并附消息。`gui_type` 支持 `into`(CSS) 或 `locate`(text|role+name|selector) 二选一。
- `gui_shot`：可选 `outDir`；失败不返回 path。
- `gui_dom`：附 `total_length` 与 `truncated`；读取失败 `ok: false`。
- `gui_run`：在独立页面执行（不扰动交互会话页），返回 `body_text_head`；断言定位器执行异常记「执行异常」，不与计数 0 混同。
- 安全事实：GUI 操作以真实用户身份生效，**不受会话权限模式（只读/读写）约束**。

注意事项（实测）：profile 里 `@deepseek-ai/dsh-mcp-client` 的版本必须与运行中 dsh 一致，否则插件行启动即禁用（日志报 disabling），对齐用 `dsh plugin --profile <p> add -E @deepseek-ai/dsh-mcp-client@<runtime-version>`。

## 路线

- M0 core 抽取 + 单测 ✓ → M1 场景层 + CLI ✓ → M2 stdio MCP server + 注册 ✓（本仓已完成）
- M3 市场化（用户启动才做）
