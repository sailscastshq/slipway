module.exports = {
  friendlyName: 'Send Telegram message',

  description: 'Send a message via Telegram bot.',

  inputs: {
    message: {
      type: 'string',
      required: true,
      description: 'The message to send (HTML formatted)'
    }
  },

  exits: {
    error: {
      description: 'Failed to send Telegram message'
    }
  },

  fn: async function ({ message }) {
    const botToken = await sails.helpers.setting.get('telegramBotToken', '')
    const chatId = await sails.helpers.setting.get('telegramChatId', '')
    const threadId = await sails.helpers.setting.get('telegramThreadId', '')

    if (!botToken || !chatId) {
      throw 'error'
    }

    try {
      const payload = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }

      if (threadId) {
        payload.message_thread_id = parseInt(threadId, 10)
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )

      const data = await response.json()
      if (!data.ok) {
        sails.log.warn('Telegram notification failed:', data.description)
        throw 'error'
      }
    } catch (err) {
      sails.log.warn('Telegram notification failed:', err.message || err)
      throw 'error'
    }
  }
}
