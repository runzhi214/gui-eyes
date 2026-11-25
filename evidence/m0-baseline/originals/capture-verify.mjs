#!/usr/bin/env node
/** 验证两个修改点:①资源总数卡问号 ②配置项弹层 取消/保存双按钮(无「关闭」)。纯 client 改动,刷新页面即生效。 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('/home/x30070689/projects/AI_Shell_WEB/package.json')
const { chromium } = require('playwright')

const HOME = homedir()
const PROFILE_DIR = join(HOME, '.cache/dsh-gui-eyes/profile')
const SHOTS_DIR = join(HOME, 'projects/dsh-gui-eyes/shots')
mkdirSync(SHOTS_DIR, { recursive: true })

const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } })
const page = context.pages()[0] ?? (await context.newPage())
const check = []
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
await page.waitForTimeout(7000) // 等 bundle 加载
// 进工作台 → 资源管理
await page.getByText('Landing Zone 工作台').first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(3000)
await page.getByText('资源管理', { exact: true }).first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(5000)

// ① 资源总数卡:问号 helpMark 应在标签旁;读 title 属性验证口径文案
const totalLabel = page.locator('text=资源总数').first()
const helpCount = await page.locator('[class*=helpMark]').count()
const totalCard = totalLabel.locator('..') // 标签所在 p
const qMark = totalCard.locator('[class*=helpMark]')
const qCount = await qMark.count()
const qTitle = qCount > 0 ? (await qMark.getAttribute('title')) ?? '' : ''
check.push({ item: '资源总数卡问号存在', ok: qCount > 0, detail: qTitle.slice(0, 60) })
check.push({ item: '问号文案含「关注服务」', ok: qTitle.includes('关注服务'), detail: qTitle.includes('关注服务') ? '命中' : '未命中' })
check.push({ item: '问号文案说明非全量口径', ok: /管理类|不计入/.test(qTitle), detail: '' })
const shot1 = join(SHOTS_DIR, `card-help-${Date.now()}.png`)
await page.screenshot({ path: shot1 })

// ② 配置项弹层:点「配置项」→ 头部应取 消/保存,无「关闭」
await page.getByRole('button', { name: '配置项' }).click({ timeout: 6000 })
await page.waitForTimeout(2500)
const modalText = await page.locator('[class*=modalPanel]').first().innerText({ timeout: 4000 }).catch(() => '')
const hasSave = /保存/.test(modalText) && await page.locator('[class*=modalPanel] button', { hasText: '保存' }).count() > 0
const hasCancel = await page.locator('[class*=modalPanel] button', { hasText: '取消' }).count() > 0
const hasClose = await page.locator('[class*=modalPanel] button', { hasText: '关闭' }).count() > 0
const targetSave = await page.locator('[class*=modalPanel] [class*=srcFocused]', { hasText: '指标目标' }).locator('button', { hasText: '保存' }).count()
check.push({ item: '弹层头部有「保存」', ok: hasSave })
check.push({ item: '弹层头部有「取消」', ok: hasCancel })
check.push({ item: '弹层无「关闭」按钮', ok: !hasClose })
check.push({ item: '指标目标区块无独立保存键', ok: targetSave === 0, detail: `剩 ${targetSave} 个` })
const shot2 = join(SHOTS_DIR, `modal-actions-${Date.now()}.png`)
await page.screenshot({ path: shot2 })

const failed = check.filter(c => !c.ok)
console.log(JSON.stringify({ check, failed: failed.length, shots: [shot1, shot2] }, null, 2))
await context.close()
process.exit(failed.length === 0 ? 0 : 1)
