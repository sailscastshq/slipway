const HOLD_PREFIX = 'deploymentRecoveryHold:v1:'
const PREFIX = 'deploymentRecovery:v1:'
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/
const id = (value) =>
  String(value && typeof value === 'object' ? value.id : value || '')
const key = (appId) => PREFIX + id(appId)

function parse(value, app) {
  if (!value) return null
  const state = typeof value === 'string' ? JSON.parse(value) : value
  if (
    state.version !== 1 ||
    !state.appId ||
    !state.environmentId ||
    (app &&
      (id(app.id) !== state.appId ||
        id(app.environment) !== state.environmentId)) ||
    !Array.isArray(state.rejectedImages) ||
    state.rejectedImages.length > 1000 ||
    state.rejectedImages.some((imageId) => !IMAGE_ID.test(imageId))
  )
    throw new Error(
      'Recovery metadata is invalid; preserve artifacts and inspect the recovery state.'
    )
  for (const release of [state.current, state.previous].filter(Boolean)) {
    if (
      !/^[1-9][0-9]*$/.test(id(release.deploymentId)) ||
      !IMAGE_ID.test(release.imageId) ||
      !Number.isFinite(release.promotedAt) ||
      (release.compatibility !== null &&
        (typeof release.compatibility !== 'string' ||
          !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(release.compatibility)))
    )
      throw new Error(
        'Recovery artifact identity is incomplete; preserve artifacts and inspect recovery state.'
      )
  }
  if (!state.current) throw new Error('Recovery current release is missing.')
  if (
    state.previous &&
    (state.previous.imageId === state.current.imageId ||
      state.rejectedImages.includes(state.previous.imageId))
  )
    throw new Error('Recovery target is current or rejected.')
  return state
}
async function load(app, db) {
  let query = Setting.findOne({ key: key(app.id) })
  if (db) query = query.usingConnection(db)
  const row = await query
  const state = parse(row?.value, app)
  if (state && id(state.current.deploymentId) !== id(app.currentDeployment))
    throw new Error(
      'Recovery state and traffic owner differ; preserve artifacts and reconcile the deployment.'
    )
  if (state && app.imageId !== state.current.imageId)
    throw new Error(
      'Recovery image identity differs from the App traffic owner.'
    )
  return { row, state }
}
function advance(app, state, release, kind = 'deploy') {
  const rejectedImages = [...(state?.rejectedImages || [])]
  const previousCurrent =
    state?.current ||
    (IMAGE_ID.test(app?.imageId || '') && app.currentDeployment
      ? {
          deploymentId: id(app.currentDeployment),
          imageId: app.imageId,
          promotedAt: app.lastDeployedAt || Date.now(),
          compatibility: null
        }
      : null)
  let previous = state?.previous || null
  if (kind === 'rollback') {
    if (!state?.previous || state.previous.imageId !== release.imageId)
      throw new Error(
        'Rollback target is no longer the previous healthy release.'
      )
    if (
      previousCurrent &&
      previousCurrent.imageId !== release.imageId &&
      !rejectedImages.includes(previousCurrent.imageId)
    )
      rejectedImages.push(previousCurrent.imageId)
    previous = null
  } else if (
    previousCurrent &&
    previousCurrent.imageId !== release.imageId &&
    !rejectedImages.includes(previousCurrent.imageId)
  ) {
    previous = previousCurrent
  }
  if (previous?.imageId === release.imageId) previous = null
  return parse(
    {
      version: 1,
      appId: id(app.id),
      environmentId: id(app.environment),
      current: release,
      previous,
      rejectedImages
    },
    app
  )
}
async function write(app, release, kind, db) {
  const { row, state } = await load(app, db)
  const next = advance(app, state, release, kind)
  if (row)
    await Setting.updateOne({ id: row.id })
      .set({ value: JSON.stringify(next) })
      .usingConnection(db)
  else
    await Setting.create({
      key: key(app.id),
      value: JSON.stringify(next)
    }).usingConnection(db)
  return next
}
module.exports = {
  HOLD_PREFIX,
  PREFIX,
  IMAGE_ID,
  id,
  key,
  parse,
  load,
  advance,
  write
}
