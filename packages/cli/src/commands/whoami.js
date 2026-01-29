import { c } from '../lib/colors.js'
import { getCredentials, isLoggedIn } from '../lib/config.js'
import { error } from '../lib/utils.js'

export default async function whoami() {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const { server, user } = getCredentials()

  console.log()
  if (user) {
    console.log(`  ${c.dim('Email:')} ${user.email}`)
    console.log(`  ${c.dim('Name:')} ${user.fullName}`)
    if (user.teamRole) {
      console.log(`  ${c.dim('Role:')} ${user.teamRole}`)
    }
  }
  console.log(`  ${c.dim('Server:')} ${server}`)
  console.log()
}
