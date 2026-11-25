import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { validateScenario } from './schema.js'

export function loadScenario(path) {
  return validateScenario(YAML.parse(readFileSync(path, 'utf8')))
}
