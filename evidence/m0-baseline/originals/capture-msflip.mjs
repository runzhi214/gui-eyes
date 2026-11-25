#!/usr/bin/env node
/** 验证 MultiSelect 语义翻转:默认全勾 / 取消一项→N 项+全选键 / 全选→回到全部。 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/x30070689/projects/AI_Shell_WEB/package.json')
const { chromium } = require('playwright')
const HOME = homedir()
mkdirSync(join(HOME, 'projects/dsh-gui-eyes/shots'), { recursive: true })

const context = await chromium.launchPersistentContext(join(HOME, '.cache/dsh-gui-eyes/profile'), { headless: true, viewport: { width: 1440, height: 900 } })
const page = context.pages()[0] ?? (await context.newPage())
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
await page.waitForTimeout(7000)
await page.getByText('Landing Zone 工作台').first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(3000)
await page.getByText('资源管理', { exact: true }).first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(5000)

// 成员视角直接有明细;主账号视角点第一条排名行下钻
let body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
if (!body.includes('资源明细')) {
  await page.locator('[class*=rankRow]').first().click({ timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(4500)
  body = await page.locator('body').innerText().catch(() => '')
}
const check = []
const svcBtn = page.getByRole('button', { name: /全部服务/ }).first()
check.push({ item: '进入明细列表(服务筛面存在)', ok: (await svcBtn.count()) > 0 })

// 打开服务下拉:默认应全部勾选
const btnHandle = await svcBtn.elementHandle()
await svcBtn.click({ timeout: 5000 })
await page.waitForTimeout(600)
const boxes = page.locator('[class*=msPanel] [class*=msRow] input[type=checkbox]')
const boxCount = await boxes.count()
const checkedCount = await Promise.all(Array.from({ length: boxCount }, (_, i) => boxes.nth(i).isChecked()))
const allOn = checkedCount.filter(Boolean).length
const footInfo = await page.locator('[class*=msFootInfo]').first().innerText().catch(() => '')
const hasAllBtn0 = (await page.locator('[class*=msClearBtn]').count()) > 0
check.push({ item: `默认全勾(${allOn}/${boxCount})`, ok: boxCount > 0 && allOn === boxCount, detail: footInfo })
check.push({ item: '全选态无「全选」按钮(无需)', ok: !hasAllBtn0 })

// 取消第一项 → 按钮「服务 N 项」+ 全选键出现
await boxes.first().uncheck()
await page.waitForTimeout(800)
const btnText1 = await btnHandle.innerText().catch(() => '')
const hasAllBtn1 = (await page.locator('[class*=msClearBtn]').count()) > 0
check.push({ item: '取消一项后按钮显 N 项', ok: /服务\s+\d+\s*项/.test(btnText1), detail: btnText1.trim() })
check.push({ item: '出现「全选」按钮', ok: hasAllBtn1 })

// 点全选 → 回到「全部服务」
await page.locator('[class*=msClearBtn]').first().click()
await page.waitForTimeout(600)
const btnText2 = await btnHandle.innerText().catch(() => '')
check.push({ item: '全选后回「全部服务」', ok: btnText2.includes('全部服务'), detail: btnText2.trim() })

const shot = join(HOME, 'projects/dsh-gui-eyes/shots/ms-flip.png')
await page.screenshot({ path: shot })
const failed = check.filter(c => !c.ok)
console.log(JSON.stringify({ check, failed: failed.length, shot }, null, 2))
await context.close()
process.exit(failed.length === 0 ? 0 : 1)
