const { defineScenario } = require('sounding')
const crypto = require('crypto')

async function createOwner({ sails, create, key }) {
  const fullName = `Builder ${key}`
  const email = `e2e+${key}@example.com`
  const password = 'secret123'

  const user = await create('user').trait('genesisOwner').with({
    fullName,
    email,
    password
  })

  const team = await create('team').with({
    name: `${fullName}'s Team`,
    owner: user.id
  })

  await sails.models.user.updateOne({ id: user.id }).set({
    team: team.id
  })

  sails.config.custom.slipwayIsSetup = true

  return {
    password,
    team,
    user: await sails.models.user.findOne({ id: user.id })
  }
}

module.exports = defineScenario(
  'configured-slipway',
  async ({ sails, sequence, create, context }) => {
    const key = sequence('configured-slipway', (n) => `configured-slipway-${n}`)
    const owner = await createOwner({ sails, create, key })

    let genesisUser = owner.user
    if (context.cliActor) {
      const rawToken = sequence(
        'configured-slipway-cli-token',
        (n) => `sounding-cli-token-${n}`
      )
      await create('clitoken').with({
        token: crypto.createHash('sha256').update(rawToken).digest('hex'),
        user: owner.user.id
      })
      genesisUser = {
        ...owner.user,
        sounding: {
          headers: {
            authorization: `Bearer sl_${rawToken}`
          }
        }
      }
    }

    const current = {
      key,
      auth: {
        genesisUserPassword: owner.password
      },
      teams: {
        genesisTeam: owner.team
      },
      users: {
        genesisUser
      }
    }

    if (context.deploymentTarget) {
      const target = context.deploymentTarget
      const project = await create('project').with({
        name: target.name || target.slug,
        slug: target.slug,
        team: owner.team.id,
        createdBy: owner.user.id
      })
      const environment = await create('environment')
        .trait('production')
        .with({ project: project.id })
      const app = await create('app')
        .trait('configured')
        .with({ environment: environment.id })

      current.projects = { deploymentTarget: project }
      current.environments = { production: environment }
      current.apps = { web: app }

      if (target.failure) {
        current.deployments = {
          failed: await create('deployment').trait('failed').with({
            environment: environment.id,
            app: app.id,
            errorMessage: target.failure
          })
        }
      }
    }

    return current
  }
)
