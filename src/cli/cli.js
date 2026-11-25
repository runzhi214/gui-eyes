import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadScenario } from '../scenario/load.js'
import { runScenario } from '../scenario/runner.js'
import { openSession } from '../core/session.js'
import { AuthError } from '../core/auth.js'
import { ScenarioSchemaError } from '../scenario/schema.js'
import { maskToken, shapeConsoleErrors, shapeFailedRequests, exitCodeFor } from '../core/report.js'

export const SPA_WAIT_MS = 6000
export const DEFAULT_HEAD_CHARS = 600

const COMMANDS = {
  shot: {
    flags: { 'base-url': 'baseUrl', 'out-dir': 'outDir', name: 'name', target: 'target' },
    defaults: { target: 'dsh-web', outDir: './shots', name: 'shot' },
  },
  dom: {
    flags: { 'base-url': 'baseUrl', head: 'head', target: 'target' },
    defaults: { target: 'dsh-web', head: DEFAULT_HEAD_CHARS },
  },
  run: {
    flags: { 'base-url': 'baseUrl', 'out-dir': 'outDir', 'timeout-scale': 'timeoutScale' },
    positional: 'scenario',
    defaults: { outDir: './shots', timeoutScale: 1 },
  },
}

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const spec = COMMANDS[command]
  if (!spec) return { error: `unknown command "${command ?? ''}" (usage: shot | dom | run)` }
  const parsed = { command, ...spec.defaults }
  const numbers = { head: '正整数', 'timeout-scale': '正数' }
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (!token.startsWith('--')) {
      if (spec.positional) {
        if (parsed[spec.positional] !== undefined) return { error: `多余的位置参数 "${token}"` }
        parsed[spec.positional] = token
      } else return { error: `未知参数 "${token}"` }
      continue
    }
    const flag = token.slice(2)
    const key = spec.flags[flag]
    if (!key) return { error: `${command} 不支持 --${flag}` }
    const value = rest[++i]
    if (value === undefined) return { error: `--${flag} 缺少取值` }
    if (numbers[flag] !== undefined) {
      const n = Number(value)
      const valid = flag === 'head' ? Number.isInteger(n) && n > 0 : n > 0
      if (!valid) return { error: `--${flag} 必须为${numbers[flag]}` }
      parsed[key] = n
    } else parsed[key] = value
  }
  if (spec.positional && parsed[spec.positional] === undefined) return { error: `缺少场景文件参数: gui-eyes run <scenario.yaml>` }
  return parsed
}

async function captureBodyText(page) {
  return page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
}

function baseReport({ session, collectors }) {
  return Promise.all([
    Promise.resolve(session.page.title()),
    captureBodyText(session.page),
  ]).then(([title, body]) => ({
    title,
    body,
    console_errors: shapeConsoleErrors(collectors.consoleErrors),
    failed_requests: shapeFailedRequests(collectors.failedRequests),
  }))
}

function reportJson({ session, base, steps, headChars, shots, asserts }) {
  return {
    auth_mode: session.authMode,
    final_url: maskToken(session.page.url()),
    title: base.title,
    steps,
    ...(asserts !== undefined ? { asserts } : {}),
    console_errors: base.console_errors,
    failed_requests: base.failed_requests,
    body_text_head: base.body.slice(0, headChars),
    shots,
  }
}

async function cmdShot(p, io) {
  const session = await io.openSession({ target: p.target, explicitBaseUrl: p.baseUrl, env: io.env })
  try {
    await session.page.waitForTimeout(SPA_WAIT_MS)
    const outDir = resolve(p.outDir)
    mkdirSync(outDir, { recursive: true })
    const path = join(outDir, `${p.name}-${Date.now()}.png`)
    let ok = true
    try { await session.page.screenshot({ path }) } catch { ok = false }
    const base = await baseReport({ session, collectors: session.collectors })
    io.out(JSON.stringify(reportJson({
      session, base,
      steps: [{ action: 'shot', arg: p.name, ok }],
      headChars: DEFAULT_HEAD_CHARS,
      shots: ok ? [path] : [],
    }), null, 2))
    return exitCodeFor({ failure: !ok })
  } finally {
    await session.context.close()
  }
}

async function cmdDom(p, io) {
  const session = await io.openSession({ target: p.target, explicitBaseUrl: p.baseUrl, env: io.env })
  try {
    await session.page.waitForTimeout(SPA_WAIT_MS)
    const base = await baseReport({ session, collectors: session.collectors })
    io.out(JSON.stringify(reportJson({
      session, base,
      steps: [{ action: 'dom', arg: '', ok: true }],
      headChars: p.head,
      shots: [],
    }), null, 2))
    return exitCodeFor({})
  } finally {
    await session.context.close()
  }
}

async function cmdRun(p, io) {
  const scenario = await io.loadScenario(p.scenario)
  const outDir = scenario.outDir !== undefined ? resolve(scenario.outDir) : resolve(p.outDir)
  const session = await io.openSession({ target: scenario.target, explicitBaseUrl: p.baseUrl, env: io.env })
  try {
    mkdirSync(outDir, { recursive: true })
    const ctx = { baseUrl: session.baseUrl, outDir, timeoutScale: p.timeoutScale, shots: [], bodyText: null }
    const { steps, asserts } = await io.runScenario(session.page, scenario, ctx)
    const base = await baseReport({ session, collectors: session.collectors })
    base.body = ctx.bodyText ?? base.body
    io.out(JSON.stringify(reportJson({
      session, base,
      steps, asserts,
      headChars: scenario.head ?? DEFAULT_HEAD_CHARS,
      shots: ctx.shots,
    }), null, 2))
    return exitCodeFor({ failure: steps.some(s => !s.ok), assertsFailed: asserts.some(a => !a.ok) })
  } finally {
    await session.context.close()
  }
}

export async function cliMain(argv, io = {}) {
  const deps = {
    out: console.log,
    err: console.error,
    env: process.env,
    openSession,
    loadScenario,
    runScenario,
    ...io,
  }
  const parsed = parseArgs(argv)
  if (parsed.error) {
    deps.err(`gui-eyes: ${parsed.error}`)
    return 1
  }
  try {
    if (parsed.command === 'shot') return await cmdShot(parsed, deps)
    if (parsed.command === 'dom') return await cmdDom(parsed, deps)
    return await cmdRun(parsed, deps)
  } catch (e) {
    if (e instanceof AuthError) {
      deps.out(JSON.stringify({ error: e.code, hint: e.hint }, null, 2))
      return 2
    }
    if (e instanceof ScenarioSchemaError) {
      deps.out(JSON.stringify({ error: 'INVALID_SCENARIO', errors: e.errors }, null, 2))
      return 1
    }
    deps.err(`gui-eyes: capture failed: ${e.message}`)
    return 1
  }
}
