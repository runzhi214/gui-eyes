#!/usr/bin/env node
/** gui-eyes MCP server (stdio): 会话保活的 GUI 采集工具面(§4.5)。 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from '../src/server/index.js'

const server = createMcpServer()
await server.connect(new StdioServerTransport())
