// #23/#24 活体 drive(2026-11-27): 直接驱动引擎自己的 createTools/createSessionManager,
// 真 chromium 对 data 页(iframe + open shadow + contenteditable)全链路验证。
// 复现: node evidence/issues-2026-11-27-drive/drive.mjs
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionManager } from '../../src/server/session-manager.js'
import { createTools } from '../../src/server/tools.js'

const parse = (r) => JSON.parse(r.content[0].text)

const pageHtml = `<!doctype html><html><body>
  <h1>主文档文本</h1>
  <div id="host"></div>
  <iframe id="f" srcdoc="<p>iframe 内文本</p>"></iframe>
  <div id="ed" contenteditable="true">旧内容旧内容</div>
  <script>
    const host = document.getElementById('host')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<p>shadow 内文本</p>'
  <\/script>
</body></html>`

const dir = mkdtempSync(join(tmpdir(), 'gui-eyes-drive-'))
const pagePath = join(dir, 'drive.html')
writeFileSync(pagePath, pageHtml)

const manager = createSessionManager()
const tools = createTools({ manager, shotsDir: () => dir })

const out = { steps: [] }
const record = (name, r) => { out.steps.push({ name, ...r }) }

await manager.open({ target: 'plain', baseUrl: `file://${pagePath}` })

// #23 默认口径: 主文档文本在, iframe/shadow 文本不在(默认不动)
const plain = parse(await tools.guiDom({ head: 500 }))
record('guiDom 默认', {
  has_main: plain.text.includes('主文档文本'),
  iframe_leaked: plain.text.includes('iframe 内文本'),
  shadow_leaked: plain.text.includes('shadow 内文本'),
  shadow_field_absent: plain.shadow_segments === undefined,
})

// #23 frame: 读到 iframe 内文本
const viaFrame = parse(await tools.guiDom({ frame: '#f' }))
record('guiDom frame', { reads_iframe: viaFrame.text.includes('iframe 内文本') })

// #23 includeShadow: 主文档 + shadow 合并, shadow_segments 计数
const withShadow = parse(await tools.guiDom({ includeShadow: true, head: 500 }))
record('guiDom includeShadow', {
  has_main: withShadow.text.includes('主文档文本'),
  has_shadow: withShadow.text.includes('shadow 内文本'),
  shadow_segments: withShadow.shadow_segments,
})

// #24 键盘路径替换 contenteditable 内容(旧 fill("") 路径已被探针证明清不掉)
const typed = parse(await tools.guiType({ into: '#ed', text: '键盘新内容' }))
const after = await manager.current().page.locator('#ed').innerText()
record('guiType contenteditable 替换', { ok: typed.ok, text_now: after.trim() })

// #24 空串 = 纯清空(键盘路径)
const cleared = parse(await tools.guiType({ into: '#ed', text: '' }))
const afterClear = await manager.current().page.locator('#ed').innerText()
record('guiType contenteditable 清空', { ok: cleared.ok, text_now: afterClear.trim() })

await manager.close()
rmSync(dir, { recursive: true, force: true })

const report = JSON.stringify(out, null, 2)
console.log(report)
writeFileSync(new URL('./drive.json', import.meta.url), report + '\n')
