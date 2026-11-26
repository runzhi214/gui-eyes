// 编号寻址 + delta 快照 — 接口设计稿(2026-11-26,采纳自 dsh-browser 调研 #1/#4,先契约后实现)
//
// ===== 动机 =====
// ① gui_click 的 text 定位歧义(matches>1 点 DOM 序第一个,issue#4 只显式化了歧义)
//    → 编号寻址根治: gui_dom 侧给元素编号, click 侧按编号点, 消除多匹配猜测。
// ② 轮询/等待类验证每轮拉 2000 字符全文, token 浪费 → delta 只回变化。
//
// ===== 机制(引擎形态差异: 无 content script 常驻,每次 evaluate 注入) =====
// dsh-browser 用常驻 content script + WeakMap 维持 element→id;我们每次调用独立 evaluate,
// WeakMap 跨调用不存活 → id 不能按"元素生命周期"记,必须按"结构稳定性"记:
// 编号 = 交互元素清单(document 序)的稳定指纹排序 —— key = tagName + 可见文本摘要 + 同签名序号。
// 同一页面两次快照,同元素同 key → 同编号(元素消失编号收敛,不错位);DOM 变化时新增元素
// 插入序列,既有元素编号保持(签名不变)。data-dsh-el 属性写回 DOM(同 dsh-browser),便于
// click 侧 ref 直达(无需重算清单)。
//
// ===== 契约(§4.2/§4.5 修订) =====
// 1. gui_dom 响应增 interactive_inventory?: [{ref, tag, text}] — ≤30 个可见交互元素
//    (a/button/input/select/textarea/[role=button|link|...]/[contenteditable] 的可见集),
//    text 截 80 字符; head 内正文照旧。默认不带清单(省 token),列出要传 withRefs: true。
// 2. gui_click 增 ref?: number(与 text/role/selector 四选一,ref 优先级同级别) — 按
//    data-dsh-el 属性直达;属性不在场(未先 gui_dom withRefs)→ not-found 并提示先列清单。
// 3. delta: gui_dom 增 delta?: true — 与该会话上次快照 diff,只回
//    {text_head?, changed_refs, removed_refs, inventory?}; 首次调用无基线 = 全量。
//    基线按 page 存,gui_open/force 重开后基线清空(诚实语义: 重开即全量)。
// 4. 断言层不动: textVisible 等语义断言仍走 getByText 引擎;编号寻址只服务交互(click/type),
//    断言用语义而非编号(编号对断言无增益,反而引入快照依赖)。
// 5. 场景 YAML 不动: 编号是 MCP 交互通道的寻址优化;场景的稳定可回放定位本就该用 selector。
//    (原则: 一次性交互用 ref 省心,可回放资产用 selector——两条通道各司其职)
//
// ===== 实现落点 =====
// src/core/inventory.js(新): buildInventory(page) → [{ref,tag,text,sel}] + writeBack data-dsh-el;
//   stableKey(el) 结构指纹; diffInventory(prev, next) → changed/removed。
// src/server/tools.js: guiDom(withRefs/delta) + guiClick(ref) + guiType(locate.ref)。
// src/server/session-manager.js: state.inventoryBaseline(per-page WeakMap 不可行——存 manager
//   侧 Map<pageUrl→snapshot>,force 重开清空)。
// 测试: 指纹稳定性(同 DOM 同序/DOM 变更保持既有编号)、ref 点击路由、delta diff 纯逻辑单测。
//
// ===== 实测确认的语义(2026-11-26,已进测试) =====
// - 结构指纹 delta:文本变化=旧签名移除+新签名出现,removed 与 changed 双报。
//   与 dsh-browser 元素级身份(WeakMap)不同——无 content script 做不出「同元素改文本」,
//   这是结构指纹的诚实后果;对轮询场景(等出现/等消失)语义完全够用。
//
// ===== 边界与放弃项 =====
// - 编号不承诺跨 SPA 路由稳定(路由切换=新页面,清单重列,agent 重新 withRefs)。
// - 不做 region/query 定位(locateAll 已覆盖)。
// - inventory ≤30 上限(dsh-browser 同款 budget 理念,防长清单爆token)。
