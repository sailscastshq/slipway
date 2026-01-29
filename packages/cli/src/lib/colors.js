// ANSI color codes
const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Slipway brand color (teal-ish)
  slipway: '\x1b[38;2;20;184;166m',
  bgSlipway: '\x1b[48;2;20;184;166m'
}

export const c = {
  error: (s) => `${codes.red}${s}${codes.reset}`,
  success: (s) => `${codes.green}${s}${codes.reset}`,
  warn: (s) => `${codes.yellow}${s}${codes.reset}`,
  info: (s) => `${codes.cyan}${s}${codes.reset}`,
  dim: (s) => `${codes.dim}${s}${codes.reset}`,
  bold: (s) => `${codes.bold}${s}${codes.reset}`,
  gray: (s) => `${codes.gray}${s}${codes.reset}`,
  highlight: (s) => `${codes.slipway}${s}${codes.reset}`,
  brand: (s) => `${codes.bgSlipway}${codes.white}${codes.bold} ${s} ${codes.reset}`
}

export default c
