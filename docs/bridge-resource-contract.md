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
            help: 'The public course description.',
            upload: {
              kind: 'image',
              storage: 'bridge',
              directory: 'courses/descriptions',
              store: 'url',
              maxBytes: 10485760
            }
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
      course: {}
    }
  }
}
```

A resource can also be removed from Bridge with `false` or `hidden: true`.

## Filters and saved lenses

Bridge exposes filters only when a resource opts fields into its `filters`
array. The field contract determines the control and the Waterline operator:

| Field type                         | Bridge filter                        |
| ---------------------------------- | ------------------------------------ |
| text, textarea, rich text, URL     | contains or exact match              |
| boolean and select                 | exact match                          |
| number and currency                | exact value or range                 |
| date, datetime, and timestamp      | exact value or range                 |
| belongs-to relationship            | authorized, searchable record picker |
| nullable fields of supported types | is empty or is not empty             |

```js
module.exports.slipway = {
  bridge: {
    resources: {
      lesson: {
        search: ['title', 'slug'],
        filters: ['title', 'published', 'creator', 'createdAt'],
        lenses: {
          published: {
            label: 'Published lessons',
            filters: {
              published: true
            },
            columns: ['title', 'creator', 'published', 'createdAt'],
            sort: {
              field: 'createdAt',
              direction: 'DESC'
            }
          },
          drafts: {
            label: 'Draft lessons',
            filters: {
              published: false
            },
            columns: ['title', 'creator', 'createdAt'],
            sort: {
              field: 'createdAt',
              direction: 'DESC'
            }
          }
        }
      }
    }
  }
}
```

A lens is a named resource view. It can fix filters, choose columns, and set a
default sort while still allowing a Bridge user to add another filter or
search. Filter, lens, search, sort, and page state are encoded in the URL, so a
view can be bookmarked or shared with another authorized Bridge user.

For a specialized view that cannot be represented with ordinary Waterline
criteria, configure a target-app helper:

```js
recentSignups: {
  label: 'Recent signups',
  columns: ['fullName', 'email', 'createdAt'],
  helper: 'bridge.lenses.recentSignups'
}
```

```js
// api/helpers/bridge/lenses/recent-signups.js
module.exports = {
  friendlyName: 'Load recent Bridge signups',

  inputs: {
    actor: { type: 'ref', required: true },
    resource: { type: 'ref', required: true },
    query: { type: 'ref', required: true }
  },

  fn: async function ({ query }) {
    const records = await User.find(query.criteria)
    const total = await User.count(query.where)
    return { records, total }
  }
}
```

The helper runs inside the target application and receives the authenticated
actor plus a normalized, bounded query. It must return `{ records, total }`.
Bridge still applies the resource's visible-column allowlist before rendering
the result.

Search, filter, and lens input is never interpolated into executable code.
Bridge validates configured fields, operators, values, relationship access,
columns, sorting, and helper identities before serializing criteria for the
target app. Fields hidden from the list or filter surfaces cannot be requested
through a lens or a forged URL.

## Dashboards

Bridge can turn the resource directory into an application-specific dashboard
without adding a second analytics service. Dashboard cards are configured in
the target application's `config/slipway.js`, resolved through Waterline or
target-app helpers, and returned as ordinary server-rendered Inertia props.

Use `dashboard` for one dashboard:

```js
module.exports.slipway = {
  bridge: {
    dashboard: {
      label: 'Content overview',
      description: 'The content and audience signals that need attention.',
      cards: {
        users: {
          type: 'metric',
          label: 'Total users',
          resource: 'user',
          aggregate: 'count'
        },
        courses: {
          type: 'metric',
          resource: 'course',
          aggregate: 'count',
          where: { published: true }
        },
        recentLessons: {
          type: 'recent',
          resource: 'lesson',
          fields: ['title', 'createdAt'],
          limit: 5
        },
        recentSignups: {
          type: 'recent',
          resource: 'user',
          fields: ['fullName', 'email', 'createdAt'],
          limit: 5
        },
        newCourse: {
          type: 'action',
          resource: 'course'
        },
        newChapter: {
          type: 'action',
          resource: 'chapter'
        },
        newLesson: {
          type: 'action',
          resource: 'lesson'
        }
      }
    }
  }
}
```

Use `dashboards` when an application needs more than one:

```js
bridge: {
  dashboards: {
    overview: {
      default: true,
      scope: 'environment',
      cards: {
        users: {
          type: 'metric',
          resource: 'user'
        }
      }
    },
    courseHealth: {
      scope: 'resource',
      resource: 'course',
      cards: {
        published: {
          type: 'metric',
          resource: 'course',
          aggregate: 'count',
          where: { published: true }
        }
      }
    }
  }
}
```

Dashboard scope may be `global`, `project`, `environment`, or `resource`.
Global, project, and environment dashboards appear on the Bridge landing page.
A resource-scoped dashboard appears above that resource's record table and
requires its `resource` identity. A contract may contain up to 12 dashboards
and 24 cards per dashboard.

### Card types

| Type        | Source                  | Result                                |
| ----------- | ----------------------- | ------------------------------------- |
| `metric`    | Waterline               | Count, sum, average, minimum, maximum |
| `recent`    | Waterline               | Up to 10 recent records               |
| `action`    | Bridge resource action  | A link to create a record             |
| `trend`     | Target-app Sails helper | Up to 31 labelled points              |
| `partition` | Target-app Sails helper | Up to 12 labelled segments            |
| `custom`    | Target-app Sails helper | A value and optional detail           |

`metric.aggregate` accepts `count`, `sum`, `average`, `min`, or `max`.
Non-count metrics require a numeric `field`. `format` accepts `number`,
`compact`, `currency`, or `percent`; currency cards also require a three-letter
`currency` code. `where` may use only fields already available on the
resource's list or filter surface.

Trend, partition, and custom helpers receive the current `actor`, a small
`dashboard` description, and the configured `card`:

```js
// api/helpers/bridge/dashboard/signups.js
module.exports = {
  friendlyName: 'Bridge signup trend',

  inputs: {
    actor: { type: 'ref', required: true },
    dashboard: { type: 'ref', required: true },
    card: { type: 'ref', required: true }
  },

  fn: async function () {
    return {
      points: [
        { label: 'Mon', value: 18 },
        { label: 'Tue', value: 26 },
        { label: 'Wed', value: 21 }
      ]
    }
  }
}
```

Custom cards return `{ value, detail }`. Partition helpers return
`{ segments: [{ label, value }] }`. Helper results are length-limited and
re-normalized before becoming Inertia props.

Dashboard cards use the same authorization boundary as their resources.
Metrics and recent records require `viewAny`; create actions require `create`;
hidden and denied resources remove their cards entirely. Recent records are
selected from configured fields and redacted again before rendering.

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

Static `actions` remain useful for permanently disabling operations. For the
common host-role boundary, configure a deny-by-default role matrix once:

```js
bridge: {
  authorization: {
    roleAttribute: 'role',
    roles: {
      admin: ['*'],
      editor: ['viewAny', 'view', 'create']
    },
    default: []
  },
  resources: {
    coursePurchase: {
      authorization: {
        roles: {
          admin: ['viewAny', 'view'],
          editor: []
        }
      }
    }
  }
}
```

The authorization model defaults to the Bridge identity model (`User`) and its
primary key. Slipway loads that host user by the stable host ID bound during
the app-local exchange, reads `roleAttribute` once per authorization pass, and
intersects the configured actions with the Bridge invitation-role ceiling.
The browser-supplied email is never used to find the user. `'*'` applies only
to actions already enabled on configured resources. Unknown users, roles, and
actions are denied; invalid models, attributes, roles, or action names reject
the resource contract.

A resource `roles` object replaces the global matrix for that resource, which
allows a sensitive resource to be narrower. `default` may only be `[]`; an
unlisted host role can never acquire access.

Keep an authorization helper only for genuinely record-specific domain
decisions that a role matrix cannot express:

```js
course: {
  authorization: {
    helper: 'course.authorizeBridgeRecord'
  }
}
```

That helper runs inside the target Sails application. It receives `actor`,
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

The actor contains a small Slipway identity context (`id`, `email`, `fullName`,
Bridge role, and current project/environment identifiers). Declarative
authorization treats only `id` as the stable host identity.

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
  actions: {
    bulkDelete: false,

    syncCatalog: {
      scope: 'resource',
      helper: {
        identity: 'catalog.sync',
        inputs: 'values'
      },
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

The object helper form invokes ordinary application domain behavior. With
`inputs: 'values'`, validated action fields become named Sails helper inputs,
so the helper's own input contract is enforced normally. `context` may
explicitly add `actor`, `resource`, `recordId`, or `recordIds`; none are passed
implicitly. The helper identity comes only from trusted server configuration.
The client cannot select or override it.

An action that returns structured data can map scalar fields into one bounded,
one-time result message:

```js
helper: {
  identity: 'license.createLicense',
  inputs: 'values',
  result: {
    message: 'License issued for {{email}}. Copy this key now: {{key}}'
  }
}
```

The template is rendered inside the target app. Only the normalized message
leaves the container, appears in the one-time flash, and is limited to 500
characters. Raw structured output, submitted values, and plaintext secrets are
not stored in the resource contract or audit log. Direct-domain-helper errors
are replaced with a generic action failure so exception text cannot leak a
secret.

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

The legacy string helper form remains available for Bridge-envelope adapters
and runs inside the target Sails application:

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
- the **Markdown** control exposes the source directly;
- an optional image upload contract lets paste and drop stream images through
  the same app-scoped R2/S3 boundary used by ordinary upload fields; and
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

Use `where` when a belongs-to field should expose only eligible records. A
fixed value or bounded `in` list is owned entirely by the server contract:

```js
lesson: {
  fields: {
    creator: {
      help: 'Only administrators can be creators.',
      relation: {
        search: ['fullName', 'email'],
        where: {
          role: { in: ['editor', 'admin'] }
        }
      }
    }
  }
}
```

A relationship can also depend on a declared sibling form field. This keeps a
Chapter selector empty until Course has a value, then scopes every initial,
search, and paginated query to that course:

```js
lesson: {
  fields: {
    course: {
      relation: {
        search: ['title', 'slug']
      }
    },
    chapter: {
      relation: {
        search: ['title', 'slug'],
        where: {
          course: { fromField: 'course' }
        }
      }
    }
  }
}
```

Dependent selectors are disabled until their source fields are ready. Changing
a source clears downstream selections, aborts stale option requests, and
prefetches the first bounded page for the new scope. Edit forms keep the label
of an existing out-of-scope value visible with a warning so it can be replaced;
the value cannot be submitted as eligible.

`where` accepts scalar string, number, or boolean equality, `{in: [...]}` with
1 to 50 values, and `{fromField: 'fieldName'}`. Slipway rejects unknown target
or source fields, unsupported operators, incompatible types, unavailable form
dependencies, and dependency cycles while normalizing the contract. Browser
query parameters can supply values only for declared `fromField` dependencies;
they cannot alter fixed constraints.

Create and update requests repeat the related resource's `viewAny`
authorization and verify that every submitted belongs-to ID both exists and
matches the identical normalized `where` scope. Relationship-backed upload
paths repeat the same verification. Hiding or modifying a selector therefore
cannot be bypassed with a forged form or upload payload.

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

When an app already has a complete conventional R2 configuration, Bridge
detects and reuses `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, and
`R2_ENDPOINT`. R2 region defaults to `auto`, so the app only needs to add its
canonical public origin:

```text
BRIDGE_R2_PUBLIC_URL=https://cdn.example.com
```

App values override environment values, which override instance-global
values. Within each scope, explicit `BRIDGE_R2_*` values take precedence when
Bridge should use a different bucket. The same fallback is available for a
complete conventional `S3_` credential set. If both conventional providers
are present, set `BRIDGE_STORAGE_PROVIDER` explicitly.

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

Bridge uses a server-owned direct-upload protocol:

- `prepare` authorizes the current actor against the target resource and
  create/edit action, validates the MIME allowlist and `maxBytes`, resolves the
  object path, and returns a signed upload intent;
- files up to 16 MiB receive a one-hour presigned `PUT` URL;
- larger files use S3-compatible multipart upload with 16 MiB parts, up to
  three concurrent browser requests, and three attempts per failed part;
- `resume` asks the storage provider which parts actually arrived and signs
  only the missing or malformed parts, so selecting the same file after a
  reload continues instead of restarting from byte zero;
- `abort` cancels the provider-side multipart upload when the user explicitly
  cancels; and
- `complete` lists and validates every part on the server, completes the
  multipart upload, then verifies the final object's exact key, byte size, and
  content type before returning the canonical URL and signed field receipt.

The browser reports aggregate byte progress across completed and in-flight
parts. A part that produces no progress for 45 seconds is treated as stalled
and retried independently. The 24-hour upload intent contains no storage
credentials or reusable part URLs; it is signed to the actor, app, project,
environment, resource, field, record, object key, file metadata, and multipart
upload ID. R2's `ListParts` response remains authoritative after a reload.
When a completion response is lost, Bridge verifies the already-completed
object and safely returns the same receipt instead of uploading a duplicate.

Preparing the upload before the multipart stream exists is important. The
legacy proxy endpoint remains for older clients and inline Markdown images,
but doing slow authorization or container work after a multipart upstream
arrives can exceed Skipper's `maxTimeToBuffer` and fail with `EMAXBUFFER`.
Increasing that timeout does not fix the race; the direct-upload protocol
removes it for file, image, and video fields.

The protocol also:

- scopes the object key to the team, project, environment, resource, and field;
- appends an opaque UUID to configured filename stems so uploads cannot
  overwrite one another or reuse a stale CDN object; and
- returns the canonical public URL plus a short-lived, signed receipt.

The subsequent create or update accepts the URL only when its receipt matches
the current actor, project, environment, resource, and field. The target model
stores only the URL. A browser therefore cannot forge a different remote URL,
alter the file size or type, or reuse an upload session or receipt across apps,
records, or fields.

Because the browser uploads directly, the bucket must allow `PUT` from every
origin where Bridge is rendered. For example, an app available both in Slipway
and through its own `/bridge` route needs both origins in its R2 CORS policy:

```json
[
  {
    "AllowedOrigins": [
      "https://slipway.example.com",
      "https://app.example.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Bridge does not trust a browser-provided multipart ETag; it lists uploaded
parts from the provider before completion, so exposing `ETag` is optional. Add
an object-store lifecycle rule that aborts incomplete multipart uploads after
one day as a final cleanup guard for abandoned tabs or expired sessions.
For a `local.sh` trial, temporarily add its exact browser origin (by default
`http://127.0.0.1:1337`, or the configured `SLIPWAY_LOCAL_URL`) to
`AllowedOrigins`. If the app-domain Bridge is also exercised locally, add that
exact origin as well. CORS origins never include a trailing path.

CORS controls which browser origins may upload; it does not make stored assets
private. Paid or otherwise protected files need authorization at the delivery
origin (for example, short-lived signed URLs enforced by a CDN rule or Worker).
An unguessable object name reduces collisions and casual enumeration, but is
not an access-control boundary.

Uploads use an environment-scoped namespace by default. An app that owns a
dedicated bucket can opt into its established bucket-root layout with safe
field templates:

```js
upload: {
  kind: 'file',
  storage: 'bridge',
  scope: 'bucket',
  directory: '{course.slug}/{chapter.title|slug}',
  filename: '{title|slug}',
  store: 'url',
  accept: ['video/mp4'],
  maxBytes: 2 * 1024 * 1024 * 1024
}
```

`directory` may reference a scalar field such as `{title}` or a scalar field
on a belongs-to relationship such as `{course.slug}`. Add `|slug` to normalize
a value into a lowercase URL-safe segment. `filename` is an extension-free
stem; Bridge appends an opaque UUID and derives the extension from the accepted
file type. Every
reference is validated against the resource contract, related records are
loaded from the target app, missing context blocks the upload, and the final
path is sanitized against traversal. `scope: 'bucket'` is explicit because it
intentionally omits Slipway's default team/project/environment namespace.
