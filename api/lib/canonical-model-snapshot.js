/** Pure normalizer: also embedded verbatim in app-container introspection. */
module.exports = function canonicalModelSnapshot(allModels, datastore) {
  const registry = Object.fromEntries(
    Object.entries(allModels).map(([key, model]) => [
      String(model.identity || key).toLowerCase(),
      model
    ])
  )
  const models = {}
  for (const identity of Object.keys(registry).sort()) {
    const model = registry[identity]
    if (
      identity.startsWith('_') ||
      !model.attributes ||
      (datastore && (model.datastore || 'default') !== datastore)
    )
      continue
    const primaryKey = model.primaryKey || 'id'
    const attributes = {}
    for (const attrName of Object.keys(model.attributes).sort()) {
      const attr = model.attributes[attrName]
      const schema = model.schema?.[attrName] || {}
      if (!attr || attr.collection || schema.collection) continue
      const physical = {
        ...(attr.autoMigrations || {}),
        ...(schema.autoMigrations || {})
      }
      const reference = attr.model || schema.model
      let referenced
      let referencedPhysical
      if (reference) {
        const target = registry[String(reference).toLowerCase()]
        const key = target?.primaryKey || 'id'
        referenced = target?.attributes?.[key]
        const targetSchema = target?.schema?.[key]
        if (!referenced)
          throw new Error(
            `Cannot resolve the primary key for ${identity}.${attrName}`
          )
        referencedPhysical = {
          ...(referenced.autoMigrations || {}),
          ...(targetSchema?.autoMigrations || {})
        }
      }
      attributes[attrName] = {
        type: reference ? referenced.type : attr.type,
        columnType:
          physical.columnType ??
          schema.columnType ??
          attr.columnType ??
          referencedPhysical?.columnType,
        columnName: schema.columnName || attr.columnName || attrName,
        primaryKey: attrName === primaryKey,
        // Only adapter directives describe database constraints. required and
        // defaultsTo remain application validation, not SQL NOT NULL/defaults.
        physical: { ...physical },
        required: Boolean(attr.required),
        unique: Boolean(
          physical.unique ??
            schema.unique ??
            attr.unique ??
            attrName === primaryKey
        ),
        index: Boolean(physical.index ?? schema.index ?? attr.index),
        autoIncrement: reference
          ? false
          : Boolean(
              physical.autoIncrement ??
                schema.autoIncrement ??
                attr.autoIncrement
            ),
        defaultsTo: attr.defaultsTo,
        autoCreatedAt: Boolean(attr.autoCreatedAt),
        autoUpdatedAt: Boolean(attr.autoUpdatedAt),
        allowNull: attr.allowNull,
        ...(reference
          ? { foreignKey: true, references: String(reference).toLowerCase() }
          : {})
      }
    }
    models[identity] = {
      identity,
      tableName: model.tableName || identity,
      primaryKey,
      attributes
    }
  }
  // The wire and in-process forms must have identical optional-field semantics.
  return JSON.parse(JSON.stringify(models))
}
