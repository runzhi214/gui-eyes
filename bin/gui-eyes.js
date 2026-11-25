#!/usr/bin/env node
import { cliMain } from '../src/cli/cli.js'

cliMain(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch(e => { console.error('gui-eyes crashed:', e); process.exit(1) })
