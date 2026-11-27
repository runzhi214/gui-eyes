import { describe, it, expect, vi } from 'vitest'
import { launchBrowserContext, LAUNCH_PLANS, firstPage } from '../src/core/browser.js'

const baseArgs = { profileDir: '/p', headless: true, viewport: { width: 1440, height: 900 } }

describe('launchBrowserContext (§5 fallback decision)', () => {
  it('returns on the first plan without fallback', async () => {
    const launch = vi.fn(async (args) => ({ args }))
    const ctx = await launchBrowserContext({ profileDir: '/p', viewport: baseArgs.viewport, launch })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0][0]).toEqual(baseArgs)
    expect(ctx.args).toEqual(baseArgs)
  })

  it('falls back to the chrome channel when bundled chromium fails to launch', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('missing chromium'))
      .mockResolvedValueOnce('ctx2')
    const ctx = await launchBrowserContext({ profileDir: '/p', viewport: baseArgs.viewport, launch })
    expect(ctx).toBe('ctx2')
    expect(launch).toHaveBeenCalledTimes(2)
    expect(launch.mock.calls[1][0]).toEqual({ ...baseArgs, channel: 'chrome' })
  })

  it('rethrows the last error when every plan fails', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
    await expect(launchBrowserContext({ profileDir: '/p', viewport: baseArgs.viewport, launch }))
      .rejects.toThrow('e2')
  })

  it('annotates the missing-browser error with self-heal guidance when both plans fail (#28)', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error("Executable doesn't exist at ~/.cache/ms-playwright/chromium-1234/chrome"))
      .mockRejectedValue(new Error('Failed to launch the browser'))
    const err = await launchBrowserContext({ profileDir: '/p', viewport: baseArgs.viewport, launch })
      .catch(e => e)
    expect(String(err.message)).toContain('自愈指引')
    expect(String(err.message)).toContain('npx playwright@1.62.1 install chromium')
    expect(String(err.message)).toContain('PLAYWRIGHT_DOWNLOAD_HOST')
  })
  it('leaves unrelated launch errors untouched — no guidance noise (#28 边界)', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
    const err = await launchBrowserContext({ profileDir: '/p', viewport: baseArgs.viewport, launch })
      .catch(e => e)
    expect(err.message).toBe('e2')
  })
  it('plans go bundled chromium first, chrome channel second', () => {
    expect(LAUNCH_PLANS).toEqual([
      { label: 'bundled-chromium', options: {} },
      { label: 'chrome-channel', options: { channel: 'chrome' } },
    ])
  })
})

describe('firstPage', () => {
  it('reuses the context page when present', async () => {
    const existing = { id: 1 }
    const context = { pages: () => [existing], newPage: vi.fn() }
    expect(await firstPage(context)).toBe(existing)
    expect(context.newPage).not.toHaveBeenCalled()
  })
  it('creates a page when the context has none', async () => {
    const created = { id: 2 }
    const context = { pages: () => [], newPage: vi.fn(async () => created) }
    expect(await firstPage(context)).toBe(created)
  })
})
