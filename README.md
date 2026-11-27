# gui-eyes

给 AI agent 装上「看任意 web GUI」的眼睛：一个带持久鉴权的浏览器采集与验证引擎，CLI 与 MCP 双通道。

- **打开**页面——30 天持久 cookie 会话（DSH web 内置鉴权自动重铸），也能采集任意公开/内网站点
- **操作**页面——点击、输入（支持 iframe 与 Shadow DOM 定位）
- **观测**页面——截图（视口/整页）、正文、console 错误、失败请求（含 DNS/连接拒绝等网络层失败）
- **验证**页面——文本可见/计数/属性正则/勾选态等断言，可反复回归

安全事实如实说明：进程内执行与原生 shell 同权，不假称安全；GUI 操作以真实用户身份生效，不受会话权限模式（只读/读写）约束。

技术路线与实现方案见 [REQUIREMENTS.md](./REQUIREMENTS.md)（设计契约，本 README 不重复）。

## 安装

```bash
pnpm install   # 不下载浏览器:复用 ~/.cache/ms-playwright 缓存,兜底 channel:'chrome'
pnpm test      # vitest 纯逻辑单测(不启浏览器)
```

## 怎么用（CLI）

```
gui-eyes run <scenario.yaml> [--base-url <url>] [--out-dir <dir>] [--timeout-scale <f>]
gui-eyes shot [--target dsh-web|plain] [--base-url <url>] [--out-dir <dir>] [--name <n>]
gui-eyes dom  [--target dsh-web|plain] [--base-url <url>] [--head <chars>]
```

- 直接跑：`node bin/gui-eyes.js run scenarios/xxx.yaml`（或 `pnpm link` 后用 `gui-eyes`）。
- 输出：stdout 单个 JSON 报告；exit 0 成功 / 1 失败或断言未全过 / 2 未鉴权（NO_TOKEN / TOKEN_STALE）。
- baseUrl 优先级：显式参数 > 场景内联声明 > `GUI_EYES_BASE_URL` 环境变量 > 内置默认（`http://127.0.0.1:3080/` 仅对 dsh-web 生效；`--target plain` 缺 baseUrl 直接报参数错误，不静默指向 dsh-web）。

### 场景 YAML

步骤流 + 断言，装载期全量校验（未知字段报错），适合反复回归：

```yaml
name: demo
target: { baseUrl: "http://127.0.0.1:8472/", auth: none }
steps:
  - goto: /
  - wait: 600
  - click: { text: 提交 }
  - dom: {}
asserts:
  - textVisible: 提交成功
```

完整 schema（6 种断言规则、iframe `frame:` 定位、内联断言等）见 REQUIREMENTS.md §4.2。

### dsh-web 鉴权 bootstrap（仅 cookie 失效时需要）

把 dsh web 终端打印的完整 URL 写入 token 文件（一行），引擎自动重铸 30 天 cookie：

```bash
echo 'http://127.0.0.1:3080/?token=...' > ~/.dsh-gui-token
```

- cookie 落 `~/.cache/dsh-gui-eyes/profile`，跨 dsh 重启不掉；**dsh 重启不需要重贴 token**——只有 cookie 本身失效（满 30 天、换 host:port、删 profile、换 DSH home、http↔https）才需贴重启后新打印的 URL。
- token 已死时报告 `TOKEN_STALE` 结构化错误（exit 2），不假报成功。
- token 只读、掩码、永不回显进报告明文。

### plain 采集任意站点

- 必须显式给 baseUrl（参数或 `GUI_EYES_BASE_URL`）。
- basic auth：`GUI_EYES_HTTP_CREDS=user:pass`。
- 启动参数（自签 HTTPS、代理、UA、locale）：`GUI_EYES_LAUNCH_JSON='{"ignoreHTTPSErrors":true,"proxy":{"server":"http://p:8080"}}'`（白名单透传）。
- 独立 profile：`~/.cache/dsh-gui-eyes/profile-plain`，与 dsh-web 鉴权 profile 隔离。

## 怎么接入（让 agent 用上）

**方式一：npm 安装（GitHub Packages）**：

```bash
npm i -g gui-eyes   # bin: gui-eyes(CLI) + gui-eyes-mcp(MCP stdio server,走 PATH)
```

**dsh profile 接入（推荐）**：两条命令，bundle 会把引擎本体自动拉进 profile：

```bash
dsh plugin --profile <p> add -E @runzhi214/gui-eyes-dsh   # 接线 bundle(自动依赖 gui-eyes 本体)
```

重启 dsh 后所有新会话获得 `mcp__gui-eyes__*` 七工具；skill 从包内 `skills/` 复制或软链到 `~/.agents/skills/`。

**方式二：本仓直用**（开发机）：**MCP 工具面**——安装 `mcp-register/` 配置-only bundle（`plugin_manager` `action: install_bundle`，target 指向本仓 `mcp-register/` 绝对路径），重启 dsh 后每个新会话自动获得 `mcp__gui-eyes__*` 七个工具（gui_open / gui_click / gui_type / gui_shot / gui_dom / gui_assert / gui_run），无需记忆、无需文档。

- 会话跨调用保活；同 baseUrl+auth 复用不重导航，页面崩溃/关闭自动重开，`force: true` 强制重开。
- profile 里 `@deepseek-ai/dsh-mcp-client` 版本必须与运行中 dsh 一致，否则插件行启动即禁用；对齐用 `dsh plugin --profile <p> add -E @deepseek-ai/dsh-mcp-client@<runtime-version>`。

**多模态分诊（文本会话要看图时）**：截图/留证任何会话都能做；但当前会话模型无图像输入能力、又需要**判读**截图内容（UI 验收）时，用 `subagent` 工具起子代理并传 `model` 选多模态路由（先 `list_subagent_models` 枚举），让子代理截图+读图并带回结论。详见 skill「gui-verification」。

**gui-verification skill**（自主验证时刻的召回）：把 `skills/gui-verification/` 复制或软链到 `~/.agents/skills/` 即可，dsh 的 skill provider 热加载，无需重启。

## 已知缺陷与边界

- **可见性口径**：`gui_dom` 读主文档 innerText——不含 iframe 与 Shadow DOM 文本（iframe 用 `frame:` 定位断言/点击，shadow 用 `textVisible` 断言可命中）；新标签页（target=_blank）用 `gui_open` 报告的 `tabs` + 各工具 `tab:` 参数寻址；截图默认仅视口，整页传 `fullPage: true`。
- **`gui_type` 清空富文本无效**：fill 实现对 ProseMirror 类编辑器 `fill("")` 清不掉——填入替换内容，不要用空串清空。
- **text 定位默认非精确**：子串匹配、多匹配点 DOM 序第一个——响应的 `matches` 字段暴露命中数，歧义时换精确选择器或 `exact: true`。
- **无登录能力**：plain 通道仅支持 basic auth 与环境变量启动参数；表单登录步骤、storageState 注入未实现。
- **并发限制**：多个 MCP 会话并发会各起一个 server、共用同一 profile 目录，撞 chromium singleton 锁——同一时间只跑一个会话。
- **场景步骤失败不中断**（catch-continue 契约）：失败步骤附 `message`，后续步骤/断言可能对着坏页面级联失败，靠消息识别页面状态不可信。
- **版本钉死**：playwright 1.62.1 依赖本机 `~/.cache/ms-playwright` 的 chromium-1234 缓存，换机需自备同版本缓存（或走 `channel:'chrome'` 兜底）。
- **MCP 工具面是会话启动快照**：引擎更新（含工具描述改动）要 dsh 重启后的新会话才触达；运行中会话与派生子代理看不到新工具。

## License

MIT（[LICENSE](./LICENSE)）。
