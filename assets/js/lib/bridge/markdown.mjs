import { marked, Renderer } from 'marked'
import DOMPurify from 'dompurify'

// Only generated Markdown markup is rendered. User HTML is discarded before
// sanitizing the result, including protocol and attribute checks.
export function renderBridgeMarkdown(value) {
  const renderer = new Renderer()
  renderer.html = () => ''
  const html = marked.parse(String(value ?? ''), {
    async: false,
    renderer
  })
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'strong',
      'em',
      'del',
      'a',
      'pre',
      'code',
      'hr'
    ],
    ALLOWED_ATTR: ['href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  })
}

export function bridgeMarkdownPreview(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const block of container.querySelectorAll(
    'p,li,pre,h1,h2,h3,h4,h5,h6,br'
  ))
    block.append(' ')
  const text = (container.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
