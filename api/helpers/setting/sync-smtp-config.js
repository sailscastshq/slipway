module.exports = {
  friendlyName: 'Sync SMTP config',

  description:
    'Read SMTP settings from the Settings model and sync them into sails.config.mail so sails-hook-mail picks them up on the next send.',

  fn: async function () {
    const host = await sails.helpers.setting.get('smtpHost', '')
    const port = await sails.helpers.setting.get('smtpPort', '')
    const username = await sails.helpers.setting.get('smtpUser', '')
    const password = await sails.helpers.setting.get('smtpPassword', '')
    const from = await sails.helpers.setting.get('smtpFrom', '')

    if (host) {
      sails.config.mail.mailers.smtp.host = host
    }
    if (port) {
      sails.config.mail.mailers.smtp.port = parseInt(port, 10) || port
    }
    if (username) {
      sails.config.mail.mailers.smtp.username = username
    }
    if (password) {
      sails.config.mail.mailers.smtp.password = password
    }
    if (from) {
      sails.config.mail.from.address = from
    }
  }
}
