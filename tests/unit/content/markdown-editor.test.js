const { Editor } = require('@tiptap/core')
const StarterKit = require('@tiptap/starter-kit').default
const Image = require('@tiptap/extension-image').default
const { Markdown } = require('@tiptap/markdown')
const { test } = require('sounding')

test('Content Manager round-trips the Markdown supported by Visual mode', async ({
  expect
}) => {
  const { preserveMarkdownEnvelope, roundTripMatches } = await import(
    '../../../assets/js/lib/content/markdown.mjs'
  )
  const fixtures = [
    '# A clear heading\n\nA paragraph with **bold**, *italic*, ~~removed~~, and `code`.\n',
    '## Useful links\n\nRead the [Slipway docs](https://example.com/docs).\n',
    '- First item\n  - Nested item\n\n1. One\n2. Two\n',
    '> A useful quotation.\n\n---\n\n```js\nconsole.log("ready")\n```\n',
    '![A calm harbour](https://example.com/harbour.png)\n'
  ]

  for (const markdown of fixtures) {
    const editor = createMarkdownEditor(markdown)
    const serialized = preserveMarkdownEnvelope(editor.getMarkdown(), markdown)

    expect(roundTripMatches(markdown, serialized)).toBe(true)
    editor.destroy()
  }
})

test('Content Manager keeps unsupported Markdown in source mode', async ({
  expect
}) => {
  const { inspectMarkdown } = await import(
    '../../../assets/js/lib/content/markdown.mjs'
  )
  const fixtures = [
    ['| Name | Status |\n| --- | --- |\n| Slipway | Ready |\n', 'tables'],
    ['- [x] Ship it\n', 'task-lists'],
    ['A note[^1].\n\n[^1]: Kept exactly.\n', 'footnotes'],
    ['<FeatureCard title="Slipway" />\n', 'mdx'],
    ['<!-- editorial note -->\n', 'html-comments'],
    [':::callout\nKeep me.\n:::\n', 'directives']
  ]

  for (const [markdown, expectedCode] of fixtures) {
    const result = inspectMarkdown(markdown)

    expect(result.supported).toBe(false)
    expect(result.issues.some(({ code }) => code === expectedCode)).toBe(true)
  }
})

test('Content Manager accepts harmless prose whitespace normalization', async ({
  expect
}) => {
  const { preserveMarkdownEnvelope, roundTripMatches } = await import(
    '../../../assets/js/lib/content/markdown.mjs'
  )
  const markdown =
    'First plain paragraph.\n\n\nSecond paragraph that is\nsoft wrapped across lines.\n'
  const editor = createMarkdownEditor(markdown)
  const serialized = preserveMarkdownEnvelope(editor.getMarkdown(), markdown)

  expect(serialized).toBe(
    'First plain paragraph.\n\nSecond paragraph that is\nsoft wrapped across lines.\n'
  )
  expect(
    roundTripMatches(markdown, serialized, (value) =>
      editor.markdown.parse(value)
    )
  ).toBe(true)
  editor.destroy()
})

test('Content Manager does not normalize meaningful code-block whitespace', async ({
  expect
}) => {
  const { roundTripMatches } = await import(
    '../../../assets/js/lib/content/markdown.mjs'
  )
  const source = '```js\nconst first = true;\n\nconst second = true;\n```\n'
  const rewritten = '```js\nconst first = true;\nconst second = true;\n```\n'
  const editor = createMarkdownEditor(source)

  expect(
    roundTripMatches(source, rewritten, (value) => editor.markdown.parse(value))
  ).toBe(false)
  editor.destroy()
})

test('Content Manager rejects unsafe links and image sources', async ({
  expect
}) => {
  const { containsRawHtml, normalizeImageUrl, normalizeLinkUrl } = await import(
    '../../../assets/js/lib/content/markdown.mjs'
  )

  expect(normalizeLinkUrl('javascript:alert(1)')).toBe(null)
  expect(normalizeLinkUrl('data:text/html,<script>')).toBe(null)
  expect(normalizeLinkUrl('file:///etc/passwd')).toBe(null)
  expect(normalizeLinkUrl('https://slipway.test/docs')).toBe(
    'https://slipway.test/docs'
  )
  expect(normalizeLinkUrl('/docs/content')).toBe('/docs/content')
  expect(normalizeLinkUrl('docs.sailscasts.com')).toBe(
    'https://docs.sailscasts.com'
  )

  expect(normalizeImageUrl('javascript:alert(1)')).toBe(null)
  expect(normalizeImageUrl('data:image/png;base64,abc')).toBe(null)
  expect(normalizeImageUrl('https://cdn.test/cover.webp')).toBe(
    'https://cdn.test/cover.webp'
  )

  expect(containsRawHtml('A normal **Markdown** paragraph.')).toBe(false)
  expect(containsRawHtml('Visit <https://sailsjs.com>.')).toBe(false)
  expect(containsRawHtml('Email <hello@sailsjs.com>.')).toBe(false)
  expect(containsRawHtml('Two is < three.')).toBe(false)
  expect(containsRawHtml('Before <script>alert(1)</script> after.')).toBe(true)
  expect(containsRawHtml('<svg/onload=alert(1)>')).toBe(true)
  expect(containsRawHtml('<FeatureCard title="Slipway" />')).toBe(true)
  expect(containsRawHtml('<!-- hidden markup -->')).toBe(true)
})

function createMarkdownEditor(content) {
  return new Editor({
    extensions: [
      StarterKit,
      Image,
      Markdown.configure({
        markedOptions: {
          gfm: true
        }
      })
    ],
    content,
    contentType: 'markdown'
  })
}
