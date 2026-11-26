import { describe, it, expect } from 'vitest'
import { createMcpServer } from '../src/server/index.js'
import { SERVER_INSTRUCTIONS } from '../src/server/instructions.js'

describe('MCP server wiring: instructions (issue #12 多模态分诊双写之一)', () => {
  it('ships on the SDK options — instructions misplaced into serverInfo silently never reach the client', () => {
    const mcp = createMcpServer()
    // McpServer(serverInfo, options); instructions 属 options。放错位置(合进 serverInfo)时
    // 协议 initialize 响应不带 instructions,且无任何报错——只有本断言能抓。
    expect(mcp.server._instructions).toBe(SERVER_INSTRUCTIONS)
  })
  it('carries the triage guidance keywords', () => {
    expect(SERVER_INSTRUCTIONS).toContain('多模态分诊')
    expect(SERVER_INSTRUCTIONS).toContain('list_subagent_models')
    expect(SERVER_INSTRUCTIONS).toContain('subagent')
  })
})
