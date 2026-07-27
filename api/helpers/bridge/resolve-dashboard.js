'use strict'

module.exports = {
  friendlyName: 'Resolve Bridge dashboard',

  description:
    'Load an authorized Bridge dashboard from the target Sails application.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    dashboard: {
      type: 'ref',
      required: true
    },
    resources: {
      type: 'ref',
      required: true
    },
    actor: {
      type: 'ref',
      required: true
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, dashboard, resources, actor }) {
    const visibleCards = dashboard.cards.filter((card) =>
      isCardAuthorized(card, resources)
    )
    if (visibleCards.length === 0) {
      return {
        ...dashboard,
        cards: []
      }
    }

    const definitions = visibleCards.map((card) => ({
      ...card,
      resourceDefinition: card.resource
        ? summarizeResource(resources[card.resource])
        : null
    }))
    const dashboardCode = buildDashboardCode({
      dashboard: {
        id: dashboard.id,
        label: dashboard.label,
        scope: dashboard.scope,
        resource: dashboard.resource
      },
      definitions,
      actor
    })
    const wrappedCode = await sails.helpers.bridge.buildSailsWrapper(
      dashboardCode
    )
    const result = await sails.helpers.bridge.executeInContainer(
      containerName,
      wrappedCode
    )

    if (!result.success) {
      sails.log.warn(
        `Bridge dashboard "${dashboard.id}" failed:`,
        result.error || 'Target app execution failed.'
      )
      return {
        ...dashboard,
        cards: visibleCards.map((card) => ({
          ...card,
          error: 'Dashboard data is temporarily unavailable.'
        })),
        error: 'Dashboard data is temporarily unavailable.'
      }
    }

    let resolved
    try {
      resolved = JSON.parse(result.output)
    } catch {
      return {
        ...dashboard,
        cards: visibleCards.map((card) => ({
          ...card,
          error: 'Dashboard data is temporarily unavailable.'
        })),
        error: 'The target app returned an invalid dashboard result.'
      }
    }

    const resultsById = new Map(
      (Array.isArray(resolved) ? resolved : []).map((card) => [card.id, card])
    )
    const cards = []
    for (const card of visibleCards) {
      const cardResult = resultsById.get(card.id) || {}
      if (typeof cardResult.error === 'string') {
        sails.log.warn(
          `Bridge dashboard card "${dashboard.id}.${card.id}" failed:`,
          cardResult.error
        )
      }
      const resolvedCard = {
        ...card,
        ...pickResult(card, cardResult)
      }

      if (card.type === 'recent' && Array.isArray(cardResult.records)) {
        resolvedCard.records =
          await sails.helpers.bridge.redactResourceRecords.with({
            records: cardResult.records,
            resource: {
              ...resources[card.resource],
              list: card.fields
            },
            surface: 'list'
          })
      }
      cards.push(resolvedCard)
    }

    return {
      ...dashboard,
      cards
    }
  }
}

function isCardAuthorized(card, resources) {
  if (!card.resource) return true
  const resource = resources[card.resource]
  if (!resource || resource.hidden === true) return false
  if (card.type === 'action') {
    return resource.actions?.[card.action] === true
  }
  return resource.actions?.viewAny === true
}

function summarizeResource(resource) {
  return {
    identity: resource.identity,
    primaryKey: resource.primaryKey,
    title: resource.title,
    label: resource.label,
    singularLabel: resource.singularLabel,
    attributes: Object.fromEntries(
      Object.entries(resource.attributes || {}).map(([name, attribute]) => [
        name,
        {
          type: attribute.type,
          columnType: attribute.columnType,
          autoCreatedAt: attribute.autoCreatedAt === true,
          autoUpdatedAt: attribute.autoUpdatedAt === true
        }
      ])
    )
  }
}

function buildDashboardCode({ dashboard, definitions, actor }) {
  return `
    const dashboard = ${JSON.stringify(dashboard)};
    const definitions = ${JSON.stringify(definitions)};
    const actor = ${JSON.stringify(actor)};
    const results = [];

    function safeText(value, limit) {
      if (typeof value !== 'string') return null;
      const text = value.replace(/\\s+/g, ' ').trim();
      return text ? text.slice(0, limit) : null;
    }

    function resolveHelper(identity) {
      let helper = sails.helpers;
      for (const segment of identity.split('.')) {
        helper = helper && helper[segment];
      }
      if (!helper || typeof helper.with !== 'function') {
        throw new Error(
          'Configured Bridge dashboard helper "' + identity + '" is unavailable.'
        );
      }
      return helper;
    }

    function finiteNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }

    function normalizeHelperResult(definition, output) {
      if (definition.type === 'trend') {
        const source = Array.isArray(output) ? output : output?.points;
        return {
          points: (Array.isArray(source) ? source : [])
            .slice(0, 31)
            .map((point) => ({
              label: safeText(point?.label, 80),
              value: finiteNumber(point?.value)
            }))
            .filter((point) => point.label && point.value !== null)
        };
      }
      if (definition.type === 'partition') {
        const source = Array.isArray(output) ? output : output?.segments;
        return {
          segments: (Array.isArray(source) ? source : [])
            .slice(0, 12)
            .map((segment) => ({
              label: safeText(segment?.label, 80),
              value: finiteNumber(segment?.value)
            }))
            .filter((segment) => segment.label && segment.value !== null)
        };
      }

      const source =
        output && typeof output === 'object' && !Array.isArray(output)
          ? output
          : { value: output };
      const value =
        ['string', 'number', 'boolean'].includes(typeof source.value) &&
        (
          typeof source.value !== 'number' ||
          Number.isFinite(source.value)
          )
          ? (
              typeof source.value === 'string'
                ? safeText(source.value, 160)
                : source.value
            )
          : null;
      return {
        value,
        detail: safeText(source.detail, 240)
      };
    }

    for (const definition of definitions) {
      try {
        if (definition.type === 'action') {
          results.push({ id: definition.id });
          continue;
        }

        if (
          ['custom', 'trend', 'partition'].includes(definition.type)
        ) {
          const helper = resolveHelper(definition.helper);
          const output = await helper.with({
            actor,
            dashboard,
            card: {
              id: definition.id,
              type: definition.type,
              label: definition.label,
              resource: definition.resourceDefinition
            }
          });
          results.push({
            id: definition.id,
            ...normalizeHelperResult(definition, output)
          });
          continue;
        }

        const model = sails.models[definition.resourceDefinition.identity];
        if (!model) {
          throw new Error('Configured Bridge dashboard resource is unavailable.');
        }

        if (definition.type === 'recent') {
          const records = await model.find({
            where: {},
            select: definition.fields,
            sort:
              definition.sort.field + ' ' + definition.sort.direction,
            limit: definition.limit
          });
          results.push({ id: definition.id, records });
          continue;
        }

        let value;
        if (definition.aggregate === 'count') {
          value = await model.count(definition.where);
        } else if (definition.aggregate === 'sum') {
          value = await model.sum(definition.field).where(definition.where);
        } else if (definition.aggregate === 'average') {
          value = await model.avg(definition.field).where(definition.where);
        } else {
          const direction = definition.aggregate === 'max' ? 'DESC' : 'ASC';
          const records = await model.find({
            where: definition.where,
            select: [
              definition.resourceDefinition.primaryKey,
              definition.field
            ],
            sort: definition.field + ' ' + direction,
            limit: 1
          });
          value = records[0]?.[definition.field] ?? null;
        }
        results.push({ id: definition.id, value: finiteNumber(value) });
      } catch (error) {
        results.push({
          id: definition.id,
          error:
            safeText(error?.message, 180) ||
            'Dashboard card is temporarily unavailable.'
        });
      }
    }

    return results;
  `
}

function pickResult(card, result) {
  const picked = {}
  if (typeof result.error === 'string') {
    picked.error = 'Dashboard data is temporarily unavailable.'
  }
  if (card.type === 'metric') {
    picked.value =
      typeof result.value === 'number' && Number.isFinite(result.value)
        ? result.value
        : null
  } else if (card.type === 'custom') {
    if (
      ['string', 'number', 'boolean'].includes(typeof result.value) &&
      (typeof result.value !== 'number' || Number.isFinite(result.value))
    ) {
      picked.value =
        typeof result.value === 'string'
          ? result.value.trim().slice(0, 160)
          : result.value
    } else {
      picked.value = null
    }
    picked.detail =
      typeof result.detail === 'string' ? result.detail.slice(0, 240) : null
  } else if (card.type === 'trend') {
    picked.points = normalizeSeries(result.points, 31)
  } else if (card.type === 'partition') {
    picked.segments = normalizeSeries(result.segments, 12)
  }
  return picked
}

function normalizeSeries(value, limit) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, limit)
    .map((item) => ({
      label:
        typeof item?.label === 'string' ? item.label.trim().slice(0, 80) : '',
      value: Number(item?.value)
    }))
    .filter((item) => item.label && Number.isFinite(item.value))
}
