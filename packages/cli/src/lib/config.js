import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Global config stored in ~/.slipway/config.json
const CONFIG_DIR = join(homedir(), '.slipway')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// Project config stored in .slipway.json in the project directory
export const PROJECT_CONFIG_FILE = '.slipway.json'

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function readConfig() {
  ensureConfigDir()
  if (!existsSync(CONFIG_FILE)) {
    return { server: '', token: '', user: null, team: null }
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return { server: '', token: '', user: null, team: null }
  }
}

function writeConfig(config) {
  ensureConfigDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

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
  if (user) config.user = user
  if (team) config.team = team
  writeConfig(config)
}

export function clearCredentials() {
  writeConfig({ server: '', token: '', user: null, team: null })
}
