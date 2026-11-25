import { describe, it, expect } from 'vitest'
import { shapeConsoleErrors, shapeFailedRequests, exitCodeFor } from '../src/core/report.js'

describe('report shaping (§4.3 caps)', () => {
  it('caps console errors at 10 keeping the earliest', () => {
    const errors = Array.from({ length: 13 }, (_, i) => `e${i}`)
    expect(shapeConsoleErrors(errors)).toEqual(errors.slice(0, 10))
  })
  it('caps failed requests at 15', () => {
    const reqs = Array.from({ length: 20 }, (_, i) => `r${i}`)
    expect(shapeFailedRequests(reqs)).toEqual(reqs.slice(0, 15))
  })
  it('keeps short lists intact', () => {
    expect(shapeConsoleErrors(['a'])).toEqual(['a'])
    expect(shapeFailedRequests([])).toEqual([])
  })
})

describe('exitCodeFor (§4.3)', () => {
  it('exit 2 for auth failures, even combined with other failures', () => {
    expect(exitCodeFor({ authError: true })).toBe(2)
    expect(exitCodeFor({ authError: true, failure: true, assertsFailed: true })).toBe(2)
  })
  it('exit 1 for a capture failure', () => {
    expect(exitCodeFor({ failure: true })).toBe(1)
  })
  it('exit 1 when any assert fails', () => {
    expect(exitCodeFor({ assertsFailed: true })).toBe(1)
  })
  it('exit 0 on clean success', () => {
    expect(exitCodeFor({})).toBe(0)
  })
})
