# Mail delivery

Slipway sends every application email through `sails-hook-mail`. The hook's
transport helper is `sails.helpers.mail.send`; app code reaches it through a
small boundary that keeps runtime notification settings consistent.

## The mail pipeline

Use the narrowest helper that matches the job:

1. `sails.helpers.notification.sendEmail` is for operational notifications
   such as deployments, backups, resource alerts, and failed jobs. It reads the
   comma-separated notification recipients from Settings and sends one message
   to each recipient.
2. `sails.helpers.mail.sendConfigured` is for a message whose recipient is
   already known, including authentication, invitations, profile changes, and
   notification test messages. It synchronizes the UI-managed SMTP settings
   into `sails.config.mail` before sending.
3. `sails.helpers.mail.send` is the transport helper supplied by
   `sails-hook-mail`. Only `mail.sendConfigured` calls it directly, so a message
   cannot accidentally bypass SMTP settings changed in the Slipway UI.

The operational path is therefore:

```text
notification.sendEmail
  -> mail.sendConfigured
    -> sails-hook-mail: mail.send
```

`notification.sendEmail` is not a second or legacy mail transport. It is a
domain helper that fans one notification out to the configured recipients.

## Templates and layouts

Templates are relative to `views/emails/` and are passed without the `.ejs`
extension:

```js
await sails.helpers.mail.sendConfigured.with({
  to: 'operator@example.com',
  subject: 'Deployment succeeded',
  template: 'deployment-notification',
  templateData: { appName: 'docs' }
})
```

`mail.sendConfigured` owns the default `mail` layout, rendered from
`views/layouts/mail.ejs`. Notification call sites must not repeat
`layout: 'mail'`: `notification.sendEmail` deliberately accepts only the
notification template, subject, and template data. Passing transport options
to that domain helper makes Sails trim the unknown value and emit an Organics
warning before the email is sent.

If a known-recipient message genuinely needs a different layout, pass the
override to `mail.sendConfigured`; do not call the hook transport directly.

## Adding a mail call

- Use `.with({ ... })` and `await` the helper.
- Use `notification.sendEmail` only when the recipients come from Notification
  settings.
- Otherwise use `mail.sendConfigured` with an explicit `to` address.
- Keep SMTP credentials in Settings; never pass them from a controller.
- Let `mail.sendConfigured` select the configured mailer, sender, and default
  layout.
- Handle delivery errors according to the flow: critical authentication mail
  should fail visibly, while background operational notifications may tolerate
  the helper's `error` exit after logging it.
