# Bridge resource contract

Bridge works without configuration by discovering the Waterline models in a
running Sails application. Applications that need a curated administration
surface can define a versioned resource contract in `config/slipway.js`.

```js
module.exports.slipway = {
  bridge: {
    schemaVersion: 1,
    resources: {
      course: {
        label: 'Courses',
        singularLabel: 'Course',
        group: 'Content',
        title: 'title',
        search: ['title'],
        list: ['title', 'published', 'createdAt'],
        show: [
          'id',
          'title',
          'description',
          'thumbnailUrl',
          'published',
          'creator'
        ],
        create: [
          'title',
          'description',
          'thumbnailUrl',
          'published',
          'creator'
        ],
        edit: ['title', 'description', 'thumbnailUrl', 'published', 'creator'],
        filters: ['published'],
        sort: {
          field: 'createdAt',
          direction: 'DESC'
        },
        actions: {
          bulkDelete: false
        },
        fields: {
          description: {
            label: 'Course description',
            type: 'richtext',
            format: 'markdown',
            help: 'The public course description.'
          },
          thumbnailUrl: {
            label: 'Thumbnail',
            type: 'upload',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: 'courses/thumbnails',
              store: 'url'
            }
          }
        }
      },

      auditLog: false
    }
  }
}
```

## Discovery

`discover` defaults to `true`. Configured resources are merged with discovered
Waterline metadata while unconfigured models continue to use sensible
defaults.

Set `discover: false` when Bridge should expose only explicitly configured
resources:

```js
module.exports.slipway = {
  bridge: {
    schemaVersion: 1,
    discover: false,
    resources: {
      course: {
        group: 'Content'
      }
    }
  }
}
```

A resource can also be removed from Bridge with `false` or `hidden: true`.

## Server enforcement

The contract is an authorization boundary, not presentation-only metadata.
Slipway validates the resource and requested action before executing a Bridge
operation. List, show, create, and edit field lists are enforced on the server:

- list queries select only `list` fields;
- record queries select only `show` or `edit` fields;
- create and update payloads reject fields absent from their configured
  surface;
- hidden resources and disabled actions cannot be reached by calling the
  endpoint directly;
- sort and search inputs are validated and serialized as data before entering
  the target app container.

Unknown resources, fields, actions, and resource options fail closed so a typo
cannot silently expose the wrong surface.

## Field options

Every field may define serializable UI metadata:

| Option        | Purpose                                      |
| ------------- | -------------------------------------------- |
| `label`       | Human-readable field name                    |
| `type`        | Explicit field renderer                      |
| `format`      | Stored value format, such as `markdown`      |
| `help`        | Short guidance shown with the field          |
| `placeholder` | Empty input hint                             |
| `readOnly`    | Render without submitting changes            |
| `sortable`    | Allow or prevent table sorting               |
| `options`     | Values for a select-style field              |
| `default`     | Literal form default or primary-key helper   |
| `currency`    | Currency display and hydration metadata      |
| `relation`    | Relationship display metadata                |
| `upload`      | Upload constraints and canonical URL storage |

Set `type: 'richtext'` and `format: 'markdown'` to use Bridge's TipTap editor:

- the stored model value remains Markdown;
- Markdown shortcuts such as `## ` and `- ` format as the editor types;
- selecting text opens the minimal bold, italic, link, strikethrough, and
  inline-code menu;
- the **Markdown** control exposes the source directly; and
- unsupported Markdown stays in source mode rather than being silently
  rewritten.

Bridge only activates the visual editor for the explicit `markdown` format.
Inferred long-text fields and rich-text fields with another format continue to
use a multiline input.

Raw HTML is denied by default and requires no additional field option. The form
blocks the save with an inline error, and the server repeats the check before
executing the mutation in the target app. Normal Markdown and autolinks continue
to work. Applications must still sanitize the HTML produced by their Markdown
renderer because stored content remains untrusted at the rendering boundary.

Uploads, currency hydration, and other specialized renderers build on the same
field contract in their respective Bridge features.

## Primary keys and belongs-to fields

Bridge derives every belongs-to value from the related model's primary key
metadata. Numeric foreign keys are normalized to numbers. UUIDs and other
string identifiers remain opaque strings through form submission, record
queries, updates, and deletes.

Auto-incrementing primary keys and model-level `defaultsTo` values remain
server-managed. A required primary key without either default appears on the
create form so Bridge never invents an application identifier format.

Applications that generate IDs with a Sails helper can keep the primary key
out of the form:

```js
module.exports.slipway = {
  bridge: {
    resources: {
      course: {
        fields: {
          id: {
            default: {
              helper: 'getUuid'
            }
          }
        }
      }
    }
  }
}
```

The helper identity may use a namespace such as `ids.getUuid`. Slipway resolves
and runs it inside the target application, then asks the target Waterline model
to validate the generated value before creating the record. Helper defaults are
currently supported only for primary keys and receive no client-controlled
inputs.

## Upload configuration boundary

Upload fields describe behavior only. Never put R2 or S3 credentials in
`config/slipway.js`, because the normalized resource contract is safe to send
to the Bridge UI.

Bridge storage credentials use `BRIDGE_`-prefixed environment variables. The
upload field engine will resolve the effective values from the current app
first, then its environment, then instance-global defaults. This lets one app
use its own R2 bucket while other apps inherit a shared provider configuration.

The R2 provider contract is:

```text
BRIDGE_STORAGE_PROVIDER=r2
BRIDGE_R2_ACCESS_KEY=...
BRIDGE_R2_SECRET_KEY=...
BRIDGE_R2_BUCKET=...
BRIDGE_R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
BRIDGE_R2_PUBLIC_URL=https://cdn.example.com
BRIDGE_R2_REGION=auto
```

The planned upload flow returns the canonical public URL and a short-lived,
server-verifiable upload receipt. The model mutation stores the URL, while the
receipt prevents a client from claiming an arbitrary object was uploaded by
Bridge.
