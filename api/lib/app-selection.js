// Callers authorize the project/environment before selecting an app here.
async function selectApp(req, environmentId, { appId } = {}) {
  const pathSlug = req.params?.appSlug
  const querySlug = req.query?.appSlug
  if (
    pathSlug !== undefined &&
    querySlug !== undefined &&
    pathSlug !== querySlug
  )
    throw 'notFound'
  const slug = pathSlug ?? querySlug
  if (
    slug !== undefined &&
    (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug))
  )
    throw 'notFound'
  const defaultApp =
    (await App.findOne({ environment: environmentId, isDefault: true })) ||
    (await App.find({ environment: environmentId }).sort('id ASC').limit(1))[0]
  const app =
    slug !== undefined
      ? await App.findOne({ environment: environmentId, slug })
      : appId != null
      ? await App.findOne({ environment: environmentId, id: appId })
      : defaultApp
  if (
    (slug !== undefined || appId != null) &&
    (!app || (appId != null && String(app.id) !== String(appId)))
  )
    throw 'notFound'
  return { app, defaultApp, explicit: slug !== undefined }
}

module.exports = selectApp
