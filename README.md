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
- baseUrl 优先级：显式参数 > `GUI_EYES_BASE_URL` > 场景声明 > `http://127.0.0.1:3080/`。
- 输出：stdout 单个 JSON（契约 §4.3）；exit 0 成功 / 1 失败或断言未全过 / 2 未鉴权（NO_TOKEN / NO_COOKIE）。

### dsh-web 鉴权 bootstrap（仅 cookie 失效时需要）

把 dsh web 终端打印的完整 URL 写入 token 文件（一行），引擎自动重铸 30 天 cookie：

```bash
echo 'http://127.0.0.1:3080/?token=...' > ~/.dsh-gui-token
```

- cookie 落 `~/.cache/dsh-gui-eyes/profile`，由持久密钥签名，30 天有效且跨 dsh 重启不掉。
- 需重贴 token 的 5 个条件见 REQUIREMENTS.md §4.4。
- token 只读、掩码、永不落盘/不回显/不进报告明文；token URL 原样使用不解析重组。

### 场景 YAML

steps + asserts 的完整 schema 见 REQUIREMENTS.md §4.2（含 2026-11-25 批准的 4 项扩展：内联 assert、`textMatches`、`checked`、`click.ifNotVisible`）。场景字眼只允许出现在 `scenarios/` 数据文件里（§8 红线）。

## 目录

- `src/core/` 机制层（target / auth / browser / primitives / observe / asserts / report / session）
- `src/scenario/` 场景装载校验 + runner；`src/cli/` CLI 壳；`src/server/` M2 留空（stdio MCP server）
- `scenarios/` 通用示例场景（`example-plain.yaml`）；workbench 四场景已迁移至 landingzone-workbench 仓 `.dsh/gui-scenarios/`
- `tests/` vitest 纯逻辑单测；`evidence/` 活体回归证据（原脚本归档与等价对照）；`shots/` 运行产物（.gitignore）

## 路线

- M0 core 抽取 + 单测（本仓已完成）→ M1 场景层 + CLI（本仓已完成）
- M2 stdio MCP server（§4.5，独立会话）→ M3 市场化（用户启动才做）
