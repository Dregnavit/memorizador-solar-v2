import { collection, documentId, limit, orderBy, query, startAfter, where } from 'firebase/firestore'
import { idSchema, uidSchema } from '@icarus/domain/schemas'

export const PRIVATE_PAGE_SIZE = 40
// The same contracts drive the client queries and the index regression checks.
export const PRIVATE_QUERIES = Object.freeze({
  palaces: { collection: 'palaces', sort: 'createdAt' },
  macroStations: { collection: 'macroStations', field: 'palaceId', sort: 'ordinal' },
  microStations: { collection: 'microStations', field: 'macroId', sort: 'ordinal' },
  sources: { collection: 'sources', sort: 'createdAt' },
  units: { collection: 'units', field: 'sourceId', sort: 'ordinal' },
  concepts: { collection: 'concepts', sort: 'createdAt' },
  unitCards: { collection: 'cards', field: 'unitId', sort: 'target' },
  activeCards: { collection: 'cards', field: 'lifecycle', value: 'active', sort: 'dueAt' },
})

export function learningQueryName(kind, field, sort) {
  const name = Object.keys(PRIVATE_QUERIES).find((key) => {
    const spec = PRIVATE_QUERIES[key]
    return spec.collection === kind && (spec.field ?? null) === field && spec.sort === sort
  })
  if (!name) throw new Error('Consulta de aprendizaje no admitida.')
  return name
}

export function buildPrivateQuery(database, uid, name, { value = null, cursor = null } = {}) {
  uidSchema.parse(uid)
  const spec = PRIVATE_QUERIES[name]
  if (!spec) throw new Error('Consulta privada no admitida.')
  const constraints = []
  if (spec.field) {
    if (spec.value !== undefined && value !== spec.value) throw new Error('Filtro de consulta no admitido.')
    if (spec.value === undefined) idSchema.parse(value)
    constraints.push(where(spec.field, '==', value))
  }
  constraints.push(orderBy(spec.sort), orderBy(documentId()))
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(PRIVATE_PAGE_SIZE + 1))
  return query(collection(database, 'users', uid, spec.collection), ...constraints)
}

export function requiredPrivateIndexes() {
  return Object.values(PRIVATE_QUERIES).filter((spec) => spec.field).map((spec) => ({
    collectionGroup: spec.collection, queryScope: 'COLLECTION', fields: [
      { fieldPath: spec.field, order: 'ASCENDING' },
      { fieldPath: spec.sort, order: 'ASCENDING' },
    ],
  }))
}
