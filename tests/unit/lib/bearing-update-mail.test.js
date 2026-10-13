const { test } = require('node:test')
const assert = require('node:assert/strict')
const mail = require('../../../api/lib/bearing-update-mail')

test('full update rendering keeps long content and safe structure in HTML and text', () => {
  const body = `# Heading\n\n${'Long paragraph. '.repeat(
    1500
  )}\n\n- First item\n- Second item\n\n![Dashboard detail](/images/dashboard.png)\n\n[Read the docs](/docs)\n\n\`\`\`js\nconst complete = true\n\`\`\`\n\nThe final authored line.`
  const output = mail.render(
    body,
    'https://app.example.test/bearing/updates/p/update'
  )
  assert.match(output.html, /<h1[^>]*>Heading<\/h1>/)
  assert.match(output.html, /<ul>/)
  assert.match(output.html, /alt="Dashboard detail"/)
  assert.match(output.html, /https:\/\/app.example.test\/images\/dashboard.png/)
  assert.match(output.html, /<pre[^>]*><code>const complete = true/)
  assert.match(
    output.text,
    /Dashboard detail.*https:\/\/app.example.test\/images\/dashboard.png/
  )
  assert.match(
    output.text,
    /Read the docs \(https:\/\/app.example.test\/docs\)/
  )
  for (const variant of [output.html, output.text]) {
    assert.equal((variant.match(/Long paragraph\./g) || []).length, 1500)
    assert.match(variant, /The final authored line\./)
  }
})
test('unsafe markup and URLs cannot execute and embeds get a linked fallback', () => {
  const output = mail.render(
    '<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n![unsafe](data:text/html,evil)\n\n<iframe src="https://video.example.test/watch"></iframe>',
    'https://app.example.test'
  )
  assert.doesNotMatch(
    output.html,
    /<script|<iframe|href="javascript:|src="data:/
  )
  assert.match(output.html, /View embedded content/)
  assert.match(
    output.text,
    /Embedded content: https:\/\/video.example.test\/watch/
  )
})
test('unsubscribe tokens are bound to consent, participant, space and address', () => {
  const consent = {
    id: 1,
    participant: 2,
    space: 3,
    emailHash: mail.emailHash('Synthetic@example.test')
  }
  const token = mail.token(consent, 'fixture-secret')
  assert.equal(mail.validToken(token, consent, 'fixture-secret'), true)
  assert.equal(
    mail.validToken(token, { ...consent, space: 4 }, 'fixture-secret'),
    false
  )
  assert.equal(mail.validToken(token, consent, 'other-secret'), false)
})
