const normalize =
  require('../../api/helpers/configuration/normalize-env-var-metadata').fn
function fixture() {
  const hook = require('../../api/hooks/secrets')({
    config: { session: { secret: 'synthetic-public-log-session-key' } }
  })
  const values = {
    APP_NAME: 'acaciaco',
    NODE_ENV: 'production',
    BRAND: 'publicowner',
    EMAIL_DOMAIN: 'example.test',
    ODD_NAME: 'unknown-private-canary-768',
    API_TOKEN: 'confirmed-secret-canary-768'
  }
  hook.remember({
    envVars: values,
    envVarMetadata: normalize({ values, recordChanges: false })
  })
  hook.rememberPublicRecord('project', {
    id: 1,
    slug: 'acaciaco',
    name: 'Acaciaco'
  })
  hook.rememberPublicRecord('environment', {
    id: 2,
    slug: 'production',
    name: 'Production'
  })
  hook.rememberPublicRecord('gitrepository', {
    id: 3,
    owner: 'publicownerhq',
    name: 'acaciaco.example',
    fullName: 'publicownerhq/acaciaco.example'
  })
  hook.rememberPublicRecord('user', { id: 4, email: 'operator@example.test' })
  return { hook, values }
}
module.exports = fixture
