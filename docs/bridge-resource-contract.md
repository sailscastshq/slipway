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
        list: ['title', 'price', 'published', 'createdAt'],
        show: [
          'id',
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'published',
          'creator'
        ],
        create: [
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'published',
          'creator'
        ],
        edit: [
          'title',
          'description',
          'thumbnailUrl',
          'price',
          'published',
          'creator'
        ],
        filters: ['published'],
        sort: {
          field: 'createdAt',
          direction: 'DESC'
        },
        actions: {
          bulkDelete: false
        },
        authorization: {
          helper: 'bridge.authorize'
        },
        relationships: {
          chapters: {
            fields: ['id', 'title'],
            search: ['title'],
            limit: 8
          },
          lessons: {
            fields: ['id', 'title'],
            search: ['title'],
            limit: 12,
            attach: true,
            detach: true
          }
        },
        fields: {
          price: {
            label: 'Price',
            type: 'currency',
            currency: {
              code: 'USD',
              storage: 'minor',
              submit: 'major'
            }
          },
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
          },
          creator: {
            relation: {
              label: 'Creator',
              search: ['fullName', 'email'],
              limit: 20
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
- parsed records are redacted again before they become Inertia props;
- create and update payloads reject fields absent from their configured
  surface;
- hidden resources and disabled actions cannot be reached by calling the
  endpoint directly;
- target app authorization helpers resolve the effective actions for the
  current actor, and denied actions are rejected by the same server path that
  hides them in the UI;
- sort and search inputs are validated and serialized as data before entering
  the target app container.

Unknown resources, fields, actions, and resource options fail closed so a typo
cannot silently expose the wrong surface.

## Field options

Every field may define serializable UI metadata:

| Option        | Purpose                                                |
| ------------- | ------------------------------------------------------ |
| `label`       | Human-readable field name                              |
| `type`        | Explicit field renderer                                |
| `format`      | Stored value format, such as `markdown`                |
| `help`        | Short guidance shown with the field                    |
| `placeholder` | Empty input hint                                       |
| `readOnly`    | Render without submitting changes                      |
| `sortable`    | Allow or prevent table sorting                         |
| `options`     | Values for a select-style field                        |
| `default`     | Literal form default or primary-key helper             |
| `sensitive`   | Mark an additional field as hidden by default          |
| `visibility`  | Per-surface `list`, `show`, `create`, `edit`, `filter` |
| `currency`    | Currency display and hydration metadata                |
| `relation`    | Relationship display metadata                          |
| `upload`      | Upload constraints and canonical URL storage           |
| `component`   | Registered Slipway field component extension point     |

Sensitive names such as password, token, secret, API key, credential, recovery
code, `emailChangeCandidate`, `planCode`, and `subscriptionCode` are omitted
from every generated surface. Encrypted and protected fields receive the same
safe treatment.

An explicit resource array is an opt-in. Field-level visibility is useful when
the resource should mostly use generated defaults:

```js
fields: {
  internalNote: {
    sensitive: true,
    visibility: {
      show: true,
      edit: true
    }
  },
  githubAccessToken: {
    visibility: {
      list: false,
      show: false,
      create: false,
      edit: false,
      filter: false
    }
  }
}
```

Setting a surface to `false` is a hard deny for that surface, including forged
payloads. Setting it to `true` explicitly opts a sensitive-name field into that
surface. Protected values are never readable through Bridge.

## Target app authorization

Static `actions` remain useful for permanently disabling operations. Add an
authorization helper when the decision depends on the signed-in actor:

```js
course: {
  authorization: {
    helper: 'bridge.authorize'
  }
}
```

The helper runs inside the target Sails application. It receives `actor`,
`action`, `resource`, and `recordId` when a record is in scope. It must return
`true` (or `{ allowed: true }`) to allow the action; falsey values, missing
helpers, malformed results, and helper errors fail closed.

```js
// api/helpers/bridge/authorize.js
const levels = {
  user: 0,
  editor: 1,
  admin: 2
}

module.exports = {
  friendlyName: 'Authorize Bridge',

  inputs: {
    actor: { type: 'ref', required: true },
    action: { type: 'string', required: true },
    resource: { type: 'ref', required: true },
    recordId: { type: 'ref' }
  },

  fn: async function ({ actor, action }) {
    const user = await User.findOne({ email: actor.email })
    if (!user) return false

    const requiredLevel = ['update', 'delete', 'bulkDelete'].includes(action)
      ? levels.admin
      : levels.editor

    return (levels[user.role] ?? -1) >= requiredLevel
  }
}
```

This matches the current Nexus split: editors can discover, read, and create;
admins can also update and delete. The actor contains a small Slipway identity
context (`id`, `email`, `fullName`, team role, and current project/environment
identifiers). The target app remains responsible for mapping that identity to
its own user and roles.

Custom actions use the same authorization helper. A denied action is removed
from the effective contract sent to the UI and the execution endpoint repeats
authorization immediately before calling the target helper.

For a record action, the authorization helper receives `recordId`. A bulk
action receives `recordIds` during execution. Resource actions receive neither.
This keeps a helper from accidentally treating a resource-level permission as
a record-level decision.

## Custom actions

Bridge actions connect a small, declarative UI contract to a Sails helper in
the target application. The configuration is data only: JavaScript functions
cannot cross the Bridge boundary.

```js
course: {
  authorization: 'bridge.authorize',
  actions: {
    bulkDelete: false,

    syncCatalog: {
      scope: 'resource',
      helper: 'bridge.syncCatalog',
      label: 'Sync catalog',
      success: 'Catalog synchronized.'
    },

    publish: {
      scope: 'record',
      helper: 'bridge.publishCourse',
      label: 'Publish course',
      description: 'Make this course available to students.',
      confirm: 'Publish this course now?',
      success: 'Course published.',
      fields: {
        notifyStudents: {
          type: 'boolean',
          label: 'Notify students',
          default: true
        },
        releaseNote: {
          type: 'textarea',
          label: 'Release note',
          help: 'Included in the student notification.',
          required: true,
          minLength: 3,
          maxLength: 280
        }
      }
    },

    regenerateLicenses: {
      scope: 'bulk',
      helper: 'bridge.regenerateLicenses',
      label: 'Regenerate licenses',
      destructive: true,
      confirm: 'Existing license links will stop working.',
      fields: {
        reason: {
          type: 'select',
          required: true,
          default: 'security',
          options: [
            { label: 'Security rotation', value: 'security' },
            { label: 'Content update', value: 'content' }
          ]
        }
      }
    }
  }
}
```

The three scopes determine where the action appears and which identifiers the
helper receives:

| Scope      | UI location                             | Helper context |
| ---------- | --------------------------------------- | -------------- |
| `resource` | Resource list toolbar                   | No record IDs  |
| `record`   | Record detail action menu               | `recordId`     |
| `bulk`     | Selected-record action menu on the list | `recordIds`    |

Bulk actions accept at most 100 selected IDs per execution. Slipway normalizes
and deduplicates every identifier against the resource primary-key contract
before authorization or helper execution.

Actions without fields, confirmation, or destructive behavior execute
directly from the menu. An action with fields or confirmation opens one focused
dialog. `destructive: true` supplies a safe confirmation message when none is
configured and uses the existing destructive button treatment.

Action fields reuse Bridge input, browser validation, and server validation.
They support:

```text
text, textarea, richtext, email, url, number, currency, boolean,
select, json, date, datetime, timestamp
```

Fields may define `label`, `help`, `placeholder`, `required`, `default`,
`options`, `min`, `max`, `minLength`, `maxLength`, `format`, and `currency`.
Defaults and option values are validated when the resource contract is
normalized. Rich text supports the explicit Markdown format and repeats the
raw-HTML denial on the server. Relationship and upload fields are not action
inputs; use record forms for those workflows.

The configured helper runs inside the target Sails application:

```js
// api/helpers/bridge/publish-course.js
module.exports = {
  friendlyName: 'Publish course',

  inputs: {
    actor: { type: 'ref', required: true },
    resource: { type: 'ref', required: true },
    values: { type: 'ref', required: true },
    recordId: { type: 'ref', required: true }
  },

  fn: async function ({ actor, values, recordId }) {
    await Course.updateOne({ id: recordId }).set({ published: true })

    if (values.notifyStudents) {
      await sails.helpers.course.notifyStudents.with({
        courseId: recordId,
        note: values.releaseNote,
        triggeredBy: actor.email
      })
    }

    return { message: 'Course published and students notified.' }
  }
}
```

Resource helpers omit `recordId`. Bulk helpers declare
`recordIds: { type: 'ref', required: true }`. A helper may return a string or
`{ message }`; Slipway normalizes the message to plain text and limits it to
500 characters. Other return data stays inside the target application.

Custom actions execute synchronously with Bridge's existing target-container
timeout. Use Quest or another background job from the helper for long-running
work, and return a message that the job was queued.

Every completed or failed helper execution creates a Slipway audit event with
the actor, project, environment, resource, action, scope, and affected record
identifiers. Submitted field values and helper return data are deliberately not
written to the audit log.

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

## Typed fields and hydration

Bridge normalizes Waterline metadata and explicit field overrides into one
field contract. The same contract drives form input, validation, mutation
hydration, list display, and record display.

Supported field types are:

```text
text, textarea, richtext, email, url, number, currency, boolean,
select, belongsTo, json, date, datetime, timestamp, password,
secret, file, image, upload
```

Email, URL, boolean, JSON, enums, relationships, timestamps, encrypted values,
and long text are inferred from Waterline metadata. Use an explicit `type` when
the stored Waterline type does not communicate the intended editor.

JSON is validated in the browser and again by Slipway, then submitted to the
target model as an object. Email and URL fields use their native browser input
types and server validation; URL values are restricted to HTTP and HTTPS.
Select values support primitives or labeled option objects:

```js
status: {
  type: 'select',
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' }
  ]
}
```

### Currency and lifecycle callbacks

Currency fields distinguish the value stored in the database from the value
submitted to the target Waterline model:

```js
price: {
  type: 'currency',
  currency: {
    code: 'USD',
    locale: 'en-US',
    storage: 'minor',
    submit: 'major'
  }
}
```

With this configuration, a stored value of `3499` is displayed and edited as
`$34.99`. Bridge submits `34.99`, so an existing `beforeCreate` or
`beforeUpdate` lifecycle callback can continue converting dollars to cents.
Set `submit: 'minor'` when the target model expects Bridge itself to submit
`3499`. Set `storage: 'major'` when the database already stores `34.99`.

`minimumFractionDigits` and `maximumFractionDigits` default to `2` and may be
overridden for currencies with a different precision.

### Custom components

The optional `component` value names a component registered with Slipway's
Bridge field registry. A registration may provide separate `form`, `list`, and
`show` components. Application configuration contains only the safe,
serializable name; it never ships executable target-app code into Slipway.

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

## Relationships

Bridge treats Waterline `model` and `collection` associations as first-class
resource metadata.

Belongs-to fields derive their label, primary-key type, title field, and search
fields from the related resource. Use the field's `relation` option only when
the generated behavior needs an override:

```js
lesson: {
  fields: {
    chapter: {
      relation: {
        label: 'Chapter',
        search: ['title', 'slug'],
        limit: 20
      }
    },
    creator: {
      relation: {
        search: ['fullName', 'email']
      }
    }
  }
}
```

The form receives only the first bounded page. Its combobox searches through a
dedicated JSON transport and loads additional pages on demand, so a large user
or course table is never serialized into an Inertia page.

Create and update requests repeat the related resource's `viewAny`
authorization and verify that every submitted belongs-to ID still exists.
Hiding a selector therefore cannot be bypassed with a forged form payload.

Collection associations appear as compact related-record lists on the detail
page. Values are selected only from the related resource's safe `show` fields.
The primary key and title field are always included; additional fields must be
explicit:

```js
course: {
  relationships: {
    chapters: {
      label: 'Chapters',
      fields: ['id', 'title', 'position'],
      search: ['title'],
      limit: 8
    }
  }
}
```

`limit` must be between 1 and 50. `search` and `fields` may reference only
fields already allowed by the related resource contract. A hidden related
resource, a denied `viewAny` decision, or an unavailable association fails
closed.

Collection mutation is disabled by default. Enable the exact operations a
resource needs:

```js
course: {
  relationships: {
    lessons: {
      attach: true,
      detach: true
    }
  }
}
```

Attach and detach use Waterline's `addToCollection()` and
`removeFromCollection()` methods. Bridge never deletes the related record.
Every mutation requires all three gates:

1. the operation is explicitly enabled on the collection relationship;
2. the current actor is allowed to `update` the parent resource; and
3. the current actor is allowed to `viewAny` on the related resource.

This keeps existing target-app authorization helpers authoritative. A
one-to-many detach can still be rejected by Waterline when the related foreign
key is required; Bridge returns that model error instead of forcing an invalid
state.

## Upload configuration boundary

Upload fields describe behavior only. Never put R2 or S3 credentials in
`config/slipway.js`, because the normalized resource contract is safe to send
to the Bridge UI.

Bridge storage credentials use `BRIDGE_`-prefixed environment variables. The
upload field engine resolves the effective values from the current app first,
then its environment, then instance-global defaults. This lets one app use its
own R2 bucket while other apps inherit a shared provider configuration.

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

The S3 provider uses the same names with `BRIDGE_S3_`:

```text
BRIDGE_STORAGE_PROVIDER=s3
BRIDGE_S3_ACCESS_KEY=...
BRIDGE_S3_SECRET_KEY=...
BRIDGE_S3_BUCKET=...
BRIDGE_S3_ENDPOINT=https://objects.example.com
BRIDGE_S3_PUBLIC_URL=https://cdn.example.com
BRIDGE_S3_REGION=us-east-1
```

Only `BRIDGE_` variables are considered. App values override environment
values, and environment values override instance-global values.

The upload endpoint:

- authorizes the current actor against the target resource and create/edit
  action before accepting bytes;
- enforces the field's MIME allowlist and `maxBytes`;
- streams directly to the configured object store instead of buffering the
  entire file in Slipway memory;
- scopes the object key to the team, project, environment, resource, and field;
  and
- returns the canonical public URL plus a short-lived, signed receipt.

The subsequent create or update accepts the URL only when its receipt matches
the current actor, project, environment, resource, and field. The target model
stores only the URL. A browser therefore cannot forge a different remote URL
or reuse a receipt across apps or fields.
