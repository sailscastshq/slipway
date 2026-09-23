const { marked } = require('marked')

const UPLOADED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:avif|gif|jpg|png|webp)$/i

function imageUrls(body) {
  const urls = new Set()
  marked.walkTokens(marked.lexer(String(body || '')), (token) => {
    if (token.type === 'image' && token.href) urls.add(token.href)
  })
  return urls
}

function ownedImagePaths(body, { publicUrl, directory }) {
  const base = new URL(publicUrl)
  const prefix = `${base.pathname.replace(/\/+$/, '')}/${directory}/`
  const paths = new Set()

  for (const href of imageUrls(body)) {
    let url
    try {
      url = new URL(href)
    } catch {
      continue
    }
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) continue
    const filename = url.pathname.slice(prefix.length)
    if (!UPLOADED_IMAGE_NAME.test(filename)) continue
    paths.add(`${directory}/${filename}`)
  }
  return paths
}

module.exports = { imageUrls, ownedImagePaths }
