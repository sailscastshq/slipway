function buildBearingSocialMetadata({
  req,
  appName,
  path,
  imagePath,
  title,
  description,
  type = 'website'
}) {
  const publicUrl = absoluteUrl(req, path)
  const ogImageUrl = absoluteUrl(req, imagePath)

  return {
    publicUrl,
    ogImageUrl,
    locals: {
      title,
      description,
      canonicalUrl: publicUrl,
      ogUrl: publicUrl,
      ogType: type,
      ogSiteName: appName,
      ogImage: ogImageUrl,
      ogImageWidth: 1200,
      ogImageHeight: 630
    }
  }
}

function absoluteUrl(req, path) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host =
    req.get('x-forwarded-host') ||
    req.get('host') ||
    req.hostname ||
    'localhost'
  return `${protocol}://${host}${path}`
}

module.exports = { buildBearingSocialMetadata }
