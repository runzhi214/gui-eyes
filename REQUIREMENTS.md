# dsh-gui-eyes 通用化需求书（gui-eyes 引擎）

> **唯一交接锚点** · 2026-11-25 定稿 · 决策 D1–D10 已全部拍板，**不得重新设计**
> 契约与仓库实际冲突、或本文件未覆盖的问题：先停下来对齐，不要自行拍板。

## 0. 一句话定位

给 agent 装上看**任意 web GUI** 的眼睛：持久鉴权会话 + 页面导航 + 截图/DOM/console/network 观测 + 断言。DSH web 是第一个内置鉴权策略，不是能力边界。

## 1. 背景与现状诊断

本仓现有三个 P1 已交付的 playwright 采集脚本（面向 DSH 3080 工作台），资产与场景焊死在一起。通用化的本质：**资产下沉为机制层，场景剥离为数据层**。

### 1.1 真正的资产（必须原样保住）

| 资产 | 证据 |
|---|---|
| DSH web 鉴权链：launch token 一次性 → 换 30 天 HMAC cookie；持久 profile；401 检测重铸 | `dsh-client-connection/src/browser-auth.ts`；cookieMaxAgeDays=30（`src/index.ts:115`）；本机实证跨 5+ 次 dsh 重启 cookie 有效 |
| 报告契约：stdout JSON + exit 0/1/2 | 三次实战验证（含破「IaC 纳管率 100%」悬案、PR !19 终验） |
| 采集原语：persistent context + chrome channel 兜底 + SPA 等待节奏 | 三个脚本 90% 重复样板 |

### 1.2 被误写成代码的场景（必须剥离）

- `BASE_URL = 'http://127.0.0.1:3080/'` 写死（3080 被占时口会变，README 有踩坑记录）
- `createRequire('/home/x30070689/projects/AI_Shell_WEB/package.json')` 借道他仓 node_modules（最脆一环）
- `SHOTS_DIR` 写死本仓路径；`getByText('Landing Zone 工作台' / '资源管理' / 'es_hwcddbdt_IaC_team')` 全是 workbench 导航
- `capture-verify.mjs` 整段「资源总数卡问号 + 配置项弹层」断言是 PR !19 一次性验收逻辑

## 2. 已定稿决策（D1–D10，2026-11-25 用户拍板）

- **D1 通用边界**：承诺任意 web GUI。Target 抽象天然支持，`auth: none` 即可采集任何页面；DSH web 只是第一个 auth 策略。
- **D2 四层架构**：core 引擎 / 场景层（YAML）/ CLI 壳 / MCP server 壳，同一 core。
- **D3 外壳终态 = MCP server**（替代原 README M-B 的 defineTool 插件路线）。理由：① dsh 插件零 npm 运行时依赖约束装不下 playwright，defineTool 路线只能 spawn 子进程自建 supervisor（等于重写 MCP 客户端）；② dsh 宿主一等支持 MCP client 注入（memory-openviking streamable-http、ops-deploy stdio 均已实证）；③ MCP server 进程天然持有浏览器会话，支持「截图→看→再点」的探索式采集。
- **D4 自研薄 MCP server**，不复用 @playwright/mcp：现有代码重构即得，DSH 鉴权链一等内聚，场景/断言层官方件缺失；官方件路线下 cookie 失效的 5 个条件触发即需人工介入。
- **D5 场景层 YAML**（steps + asserts）。**引擎本体零场景字眼**；workbench 三条流程迁为场景文件，归属 landingzone-workbench 仓 `.dsh/gui-scenarios/`。
- **D6 playwright 依赖自持**：引擎独立成包、自带依赖声明；浏览器继续复用 `~/.cache/ms-playwright` 缓存保持准零安装；删除一切借道 AI_Shell_WEB 的 createRequire。
- **D7 报告契约向后兼容**：核心 JSON 字段（§4.3）与 exit code 语义不变，允许新增字段，不允许改名/删字段。旧字段 `clicked_workbench` 属场景层输出，随 legacy 脚本退役，由通用 `steps` 摘要替代。
- **D8 视觉读图不并入引擎**：采集归引擎，读图归 agent 多模态（read_image / flash 子代理），保持解耦。
- **D9 仓库名与目录**维持 `~/projects/dsh-gui-eyes` 不迁移（防止既有引用悬空）；对外 npm 包名在 M3 发布时定为 `gui-eyes`。
- **D10 鉴权策略插件化**：`auth: dsh-cookie | none`，结构可扩展；baseUrl 解析优先级见 §4.1，不做过度的端口自动发现。

## 3. 目标架构

```
┌────────────────── 外壳层（同一 core，三种入口）──────────────────┐
│  CLI（一次性）        MCP server（会话保活，M2）    dsh defineTool（可选薄壳，仅 when/approval 深集成时后补）│
├──────────────────────────────────────────────┤
│  场景层：*.yaml（steps + asserts + shots）—— 工具本体不内置任何场景          │
├──────────────────────────────────────────────┤
│  core 引擎（自持 playwright 的 Node 包）                                    │
│  · Target：dsh-web（默认 3080）/ plain（任意 baseUrl + auth none）           │
│  · AuthStrategy：dsh-cookie（现有逻辑）/ none                              │
│  · 原语：goto / click / type / wait / shot / domText / console / net        │
│  · 断言：textVisible / textNotVisible / attrMatches / count                │
│  · 报告契约：现有 JSON + exit 0/1/2（§4.3，不动）                            │
└──────────────────────────────────────────────┘
```

## 4. 接口契约

### 4.1 CLI（M0/M1 交付）

```
gui-eyes shot [--target <key>] [--base-url <url>] [--out-dir <dir>] [--name <n>]
gui-eyes dom   [--target <key>] [--base-url <url>] [--head <chars>]
gui-eyes run   <scenario.yaml> [--base-url <url>] [--out-dir <dir>] [--timeout-scale <f>]
```

- `--target`：`dsh-web`（默认）或 `plain`。
- baseUrl 解析优先级：**显式参数 > 环境变量 `GUI_EYES_BASE_URL` > 场景文件 target 声明 > 默认 `http://127.0.0.1:3080/`**。
- `--out-dir` 默认**当前工作区**下的 `./shots`（bwrap 沙箱 /tmp 不跨 bash 调用保留，产物必须落工作区）。
- `--timeout-scale`：全局等待时间缩放因子（默认 1），供慢环境回归。
- dsh-cookie 失效时行为：有 token 文件 → 自动重铸（`auth_mode: token-bootstrap`）；无 → `NO_TOKEN` 结构化输出 + exit 2。

### 4.2 场景 YAML schema（M1 交付）

```yaml
name: <场景名>            # 必填，进报告
description: <一句话>      # 可选
target: dsh-web            # 或内联: { baseUrl: "http://host:port/", auth: none }
outDir: ./shots            # 可选，默认 CLI --out-dir
steps:                     # 按序执行
  - goto: /                # 相对 target.baseUrl 的路径
  - wait: 6000             # ms
  - click: { text: "资源管理", exact: true }   # text | role+name | selector 三选一
  - click: { role: button, name: 配置项 }
  - click: { selector: "[class*=helpMark]" }
  - type: { into: <selector>, text: <字符串> }
  - shot: <名称>           # 落 <outDir>/<名称>-<timestamp>.png，路径进报告
  - dom: {}                # 采 body innerText（head 截断进报告；全文按需见 asserts）
asserts:                   # 全过 exit 0，任一失败 exit 1
  - textVisible: "关注服务"
  - textNotVisible: "关闭"
  - attrMatches: { selector: "[class*=helpMark]", attr: title, regex: "管理类|不计入" }
  - count: { selector: "[class*=modalPanel] button", hasText: 保存, equals: 1 }
```

- 步骤/断言执行失败不中断后续步骤（与现有脚本 catch-continue 语义一致），失败项进报告；断言结果逐条进报告。
- schema 校验在装载期完成，未知字段报错不静默忽略。
- **2026-11-25 会话补充（用户已批准，随 capture-msflip.mjs 并入 M1 迁移）**：
  1. steps 列表允许内联断言 `- assert: { <rule>: ... }`：与步骤同序执行、失败不中断，结果与后置断言同序进报告 `asserts` 数组，exit 语义不变。
  2. 断言规则 `textMatches: { selector, regex }`：首个匹配元素 innerText 按正则校验（后端数据决定的动态文案，如「服务 N 项」）。
  3. 断言规则 `checked: { selector, all: true }`：匹配的 checkbox 全部勾选且数量 > 0（勾选态是 DOM property，attrMatches 不覆盖）。
  4. click 可选修饰 `ifNotVisible: <文本>`：文本已可见则跳过该点击（视角自适应分支）。

### 4.3 报告 JSON 契约（向后兼容，D7）

stdout 单个 JSON 对象，字段与语义：

| 字段 | 语义 |
|---|---|
| `auth_mode` | `cookie` \| `token-bootstrap` \| `none` |
| `final_url` | 最终 URL，**必须经过 token 掩码**（`token=[^&\s']*` → `token=***`） |
| `title` | 页面 title |
| `steps` | 逐步摘要 `[{action, arg, ok}]`（替代旧 `clicked_workbench`，M1 起） |
| `asserts` | 逐条断言结果 `[{rule, ok, detail}]`（仅 run） |
| `console_errors` | console error，单条截 300 字符，最多 10 条 |
| `failed_requests` | HTTP≥400；非 `/api/` 记完整 URL（掩码后），`/api/` 截 120 字符，最多 15 条 |
| `body_text_head` | body innerText 头部（默认 600 字符，`--head`/场景可调） |
| `shots` | 截图绝对路径数组 |

exit code：**0** 成功且断言全过；**1** 采集失败或断言未全过；**2** 未鉴权（NO_TOKEN / NO_COOKIE，输出含 `error` 与 `hint` 字段）。

### 4.4 鉴权契约（dsh-cookie，全部实测事实，勿再排查）

- launch token 一次性，只打在 dsh web 终端（不落盘）；`GET /?token=...` → 303 → 30 天 HMAC cookie。
- cookie 签名密钥持久化于 `~/.dsh/.credentials.yaml`（`records/client-connection/browser-session`），跨 dsh 重启不变 → **重启后无需重贴 URL**。
- token 文件路径：`~/.dsh-gui-token`（优先；内容 = dsh web 打印的完整 URL，一行）。`/tmp/dsh-gui-token` 仅作兜底——bwrap 下 /tmp 不跨 bash 调用保留，README/提示一律引导写 home 路径。
- 持久 profile：`~/.cache/dsh-gui-eyes/profile`。
- 401 判定：body innerText 含 `authentication required`；先 goto 探测，cookie 优先，仅命中才读 token 文件重铸。
- 需重贴 token 的 5 个条件（其余情况免 token）：① cookie 满 30 天 ② host:port 变（cookie 绑 authority）③ 删了 profile 目录 ④ 换 DSH home / 清凭据记录 ⑤ http↔https 切换。
- **token URL 必须原样使用**：拆开重组返回 400（可能带 hash 路由），禁止解析重组。
- 无头上下文 `/api/aishell/permission` 返回 400 属预期（权限 chip 本就隐藏，不阻塞，不进 failed_requests 告警逻辑可保留原样记录）。
- 安全红线：token 只读、掩码、永不落盘/不回显/不进报告明文。

### 4.5 MCP 工具面（M2 交付，本会话不实现，形状先行定死给 M2 留槽）

stdio MCP server，工具 6 个：`gui_open`（target/baseUrl，建立/复用会话并返回报告）、`gui_click`（text | role+name | selector）、`gui_type`、`gui_shot`（name → 路径）、`gui_dom`（head 可调）、`gui_assert`（asserts 数组）。`gui_run`（scenario 路径）第 7 个可选。会话保活：persistent context 跨工具调用复用，401 自动重铸。实现优先官方 `@modelcontextprotocol/sdk`，冲突才手写 JSON-RPC。

## 5. 环境事实与已踩坑（勿再考古）

| 事实 | 处置 |
|---|---|
| playwright 1.62.1 现借道 `~/projects/AI_Shell_WEB/node_modules` | M0 起自持依赖声明；装包不触发浏览器下载，缓存继续用 |
| 浏览器：`~/.cache/ms-playwright` 的 chromium-1234；兜底 `channel:'chrome'`（`/usr/bin/google-chrome`） | launch 失败自动降级 channel，两条路径都写单测可覆盖的纯逻辑（降级决策），真启浏览器留给活体回归 |
| 本机 bash 是 bwrap 沙箱（`--unshare-pid`），/tmp 不跨调用保留 | 一切产物落工作区；默认 outDir = cwd 相对 |
| 3080 可能被占（2026-11-23 实际发生过） | baseUrl 优先级链（§4.1）+ 失效提示引导 `--base-url` 覆盖，不做端口扫描发现 |
| 无头上下文 permission API 400 | 预期行为，忽略 |
| 视觉判断依赖多模态模型（主 agent glm-5.3 无图像输入，读图走 flash 子代理/opengw） | 引擎不管读图（D8） |
| **2026-11-25 实测补充**：`~/.cache` 只读（沙箱 EROFS）时 chromium 静默回退**内存 cookie 库**——运行期内 cookie 有效，进程 close 即丢、Cookies 文件 mtime 不动；可写后正常落盘 | 活体运行需 `~/.cache` 可写，否则每次运行都走 token 重铸链；cookie「丢失」先查可写面再查 5 条失效条件 |
| **2026-11-25 实测补充**：launch token 在 dsh web 服务器进程存活期内实测可多次兑付（两次间隔约 60 秒均成功换 cookie），与「一次性」的设计意图存在宽限 | 事实记录；引擎行为不变（仍按 §4.4 惰性重铸）；不可依赖此宽限做长期方案 |

## 6. 目标目录结构

```
dsh-gui-eyes/
├── REQUIREMENTS.md        # 本文件，唯一交接锚点
├── README.md              # 索引 + 快速用法，M0 重写指向本文件
├── package.json           # name: gui-eyes, type: module, deps: playwright ^1.62.1; devDeps: vitest
├── src/
│   ├── core/              # target / auth(dsh-cookie|none) / browser / primitives / asserts / report
│   ├── scenario/          # YAML 装载校验 + runner
│   ├── cli/               # shot / dom / run 子命令
│   └── server/            # M2: stdio MCP server（M0/M1 留空目录即可）
├── scenarios/             # 通用示例场景（无场景字眼；workbench 迁移文件验收后移出，见 §7 M1）
├── legacy/                # M0 期三个旧脚本的薄壳，M1 验收后删除
├── shots/                 # 运行产物（.gitignore）
└── tests/                 # vitest，纯逻辑单测
```

## 7. 里程碑与验收（逐条可机器/可取证判定）

### M0 骨架与 core 抽取（本会话）

- git init（首次 commit 将 REQUIREMENTS.md 与代码一起入库）；package.json 自持依赖；`.gitignore`（shots/、node_modules/）。
- core 抽取：**capture.mjs 的鉴权逻辑是本仓最贵资产，逐行对照移植，不许改语义**；三个旧脚本降级为 `legacy/` 薄壳（workbench 导航暂留壳内）。
- 单测（vitest，不启浏览器、不连活 GUI）：token 掩码、401 判定、token 文件读取、报告塑形、baseUrl 优先级、降级决策、YAML 之外的纯逻辑。
- 验收：① `pnpm test` 全绿；② 活体回归——在跑的 dsh web 上经 legacy 薄壳逐条复跑三流程，报告字段等价（时间戳/路径类字段除外）；③ grep 闸门——`src/core`、`src/cli` 无场景字眼（`工作台`、`资源管理`、`IaC`、团队账号名）；④ 仓库无 `createRequire.*AI_Shell_WEB` 残留。

### M1 场景层（本会话）

- §4.2 schema 装载校验 + runner + 断言引擎 + `gui-eyes run/shot/dom` CLI。
- 三条 workbench 流程（capture / drill / verify）写成场景文件放 `scenarios/`，活 GUI 上跑绿后**复制到 landingzone-workbench 仓 `.dsh/gui-scenarios/` 并从本仓删除**（场景归场景所属仓，本仓只留通用示例）。
- legacy/ 三薄壳删除。
- 验收：① 单测全绿（schema 校验含未知字段报错、断言引擎各规则正/反例）；② 三场景活体跑绿（断言逐条过，exit 0）；③ grep 闸门同 M0；④ README 重写为新用法索引。
- **2026-11-25 会话执行记录（用户拍板的两处口径）**：① `capture-msflip.mjs` 并入迁移（第 4 个场景，契约修正见 §4.2 附录）；② drill 的 P1 断言数据（IaC 团队排名行 + 7 个 ep 名）在当前活 GUI 上已不存在（视图漂移为成员视角），场景按现实重写为「视图自适应下钻 + 验证明细列表在场」，易漂移业务数据不进场景，workbench 侧接手后自行加强断言。
- **后续动作（非本会话）**：landingzone-workbench 仓 `scripts-dev/vision-gui.mjs` 改调本引擎、接收场景文件——由 workbench 侧会话按 §4.2 契约执行。

### M2 MCP server（已于 2026-11-26 本会话完成，原计划独立会话——用户拍板拉入）

- §4.5 工具面 + 会话保活 + dsh profile 注入（参考 memory-openviking 的 mcp client 条目形态与 ops-deploy 的 stdio 接入先例）。
- 验收：① 子代理新会话真机可见 7 工具并实际调用成功；② 删 `~/.cache/dsh-gui-eyes/profile` 模拟 cookie 失效，token 文件在场时自动重铸成功；③ 无 token 时 `gui_open` 返回 NO_TOKEN 结构化错误而非进程崩溃；④ `--profile web --dump-config` 可见注入条目。
- **2026-11-26 执行记录（四条验收全过，证据 `evidence/m2/`）**：
  1. `@modelcontextprotocol/sdk` 1.32.2 + zod，`bin/gui-eyes-mcp.js` stdio 入口；`src/server/`：session-manager（同 target 复用/异 target 关旧开新）、tools（7 工具全复用 core，click/type 内置 800ms settle，截图默认落引擎仓 `shots/`）、index（SDK wiring + 统一错误面：NO_SESSION/NO_TOKEN/INVALID_SCENARIO 结构化 isError）。
  2. 单测 110/110（session-manager 保活语义、7 工具正反例，纯逻辑不启浏览器）。
  3. 注册走配置-only bundle `mcp-register/`（stdio + `failOnStartupError: true`），`plugin_manager install_bundle` applied。
  4. **验收踩坑与事实**：
     - profile 曾把 `@deepseek-ai/dsh-mcp-client` 钉死在 `0.2.1-alpha.1`，与 dsh 0.2.2-rc.5 不匹配 → 插件行每次启动被禁用（日志反复报 disabling）。已用 `dsh plugin --profile web add -E @deepseek-ai/dsh-mcp-client@0.2.2-rc.5` 对齐运行时版本，**未走版本豁免**；改 profile 依赖后需重启 dsh 生效。
     - launch token 随 dsh 进程重启轮换——重启后必须重贴新 URL（token 文件里旧 URL 失效是预期，非引擎 bug）。重铸判据须「auth_mode=token-bootstrap 且正文无 401 文案」双验，防 token 死时假绿。
     - **验证载体陷阱**：MCP 连接按会话启动时建立；运行中的旧会话（含其派生子代理）看不到新注入的工具。验收①必须用安装/修复之后启动的全新会话。
     - `gui_shot` 曾因默认参数写成 `shotsDir = defaultShotsDir()`（调用而非引用）在真实链路上崩——单测全显式传参恰好绕过，由协议级活测抓出。回归测试已锚定。

### M3 可选市场化（独立会话，用户启动才做）

展示元数据、图标、多语言、许可证、打包白名单、发布；npm 包名 `gui-eyes`（D9）。

## 8. 红线与反例

- `src/` 任何源码不得出现场景字眼（团队名、工作台/资源管理类页面文案、特定项目名）；场景字眼只允许出现在 `scenarios/` 数据文件里。
- 凭据纪律：token 只读、掩码（`token=[^&\s']*` → `token=***`）、永不落盘/回显/进报告明文；token URL 原样使用不解析重组。
- 单测不依赖活 GUI 与真实网络；活体回归独立执行并留证据（截图路径、报告 JSON）。
- 不引入 playwright 之外的运行时大依赖；MCP server 的 SDK 选择见 §4.5。
- 不假称安全：进程内执行即与原生 shell 同权，README 如实写明。

## 9. 边界外（明确不做）

- 视觉读图/多模态判断（D8）。
- dsh defineTool 插件壳（除非后续需要 `when` 工作区可见性 / approval 深集成才后补）。
- 录制器、浏览器 GUI、移动端设备仿真（viewport 1440×900 固定，可参数化即可）。
- 端口扫描式自动发现（D10：优先级链 + 显式覆盖即可）。
