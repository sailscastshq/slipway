import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { credentialStore } from './credential-store.js'

// Global config stored in ~/.slipway/config.json
const CONFIG_DIR = join(homedir(), '.slipway')
const store = credentialStore(CONFIG_DIR)

// Project config stored in .slipway.json in the project directory
export const PROJECT_CONFIG_FILE = '.slipway.json'

const readConfig = () => store.read()
const writeConfig = (config) => store.write(config)

export function getProjectConfig() {
  const configPath = join(process.cwd(), PROJECT_CONFIG_FILE)
  if (!existsSync(configPath)) {
    return null
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return null
  }
}

export function saveProjectConfig(projectConfig) {
  const configPath = join(process.cwd(), PROJECT_CONFIG_FILE)
  writeFileSync(configPath, JSON.stringify(projectConfig, null, 2) + '\n')
}

export function isLoggedIn() {
  const config = readConfig()
  return Boolean(config.token && config.server)
}

export function getCredentials() {
  return readConfig()
}

export function setCredentials({ server, token, user, team }) {
  const config = readConfig()
  if (server) config.server = server
  if (token) config.token = token
  if (user !== undefined) config.user = user
  if (team !== undefined) config.team = team
  writeConfig(config)
}

export function clearCredentials() {
  writeConfig({ server: '', token: '', user: null, team: null })
}
