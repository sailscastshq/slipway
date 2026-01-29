import { clearCredentials, isLoggedIn } from '../lib/config.js'
import { success, info } from '../lib/utils.js'

export default async function logout() {
  if (!isLoggedIn()) {
    info('Not currently logged in')
    return
  }

  clearCredentials()
  success('Logged out successfully')
}
