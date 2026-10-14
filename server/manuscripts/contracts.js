import { sourceSchema, sourceRevisionSchema, unitSchema, conceptSchema, conceptEdgeSchema, encodingSchema, cardSchema, reviewEventSchema, locusSchema } from '@icarus/domain/schemas'
import { literalProgramSchema, literalCardSchema, literalExerciseSchema, literalBindingSchema, literalAttemptSchema } from '@icarus/domain/literal'
import { workshopPayloadSchema } from '@icarus/domain/encoding'

const contracts = { sources: sourceSchema, units: unitSchema, concepts: conceptSchema, conceptEdges: conceptEdgeSchema, encodings: encodingSchema, cards: cardSchema, reviewEvents: reviewEventSchema, literalPrograms: literalProgramSchema, literalCards: literalCardSchema, literalExercises: literalExerciseSchema, literalBindings: literalBindingSchema, literalAttempts: literalAttemptSchema, microStations: locusSchema }
function contract(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value?.seconds !== undefined && value?.nanoseconds !== undefined ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : value]))
}
export function validateInventoryDocument(kind, snapshot) {
  const d = snapshot.data(); const schema = contracts[kind]
  if (schema) return schema.safeParse(contract(d)).success && d.id === snapshot.id
  if (kind === 'encodingDrafts') return d.schemaVersion === 1 && d.id === snapshot.id && typeof d.unitId === 'string' && ['draft', 'published'].includes(d.status) && workshopPayloadSchema.safeParse(d.payload).success
  if (kind === 'literalHints') return d.id === snapshot.id && typeof d.sourceId === 'string' && typeof d.programId === 'string' && typeof d.exerciseId === 'string' && [1, 2, 3].includes(d.level)
  if (kind === 'literalMemberships') return d.id === snapshot.id && d.id === d.unitId && typeof d.sourceId === 'string' && typeof d.sourceRevisionId === 'string'
  if (kind === 'sourceOperations') return d.id === snapshot.id && typeof d.sourceId === 'string' && ['active', 'archived'].includes(d.target) && Number.isInteger(d.outcomeVersion)
  if (kind === 'sourceEvents') return d.id === snapshot.id && typeof d.sourceId === 'string' && ['active', 'archived'].includes(d.to) && d.newVersion === d.previousVersion + 1
  // These reserved collections do not yet have a writer/contract in this repository.
  // Unknown records must be assessed before deleting a graph that could reference them.
  return false
}
export function validateRevision(path, data) {
  const parts = path.split('/')
  if (parts.length !== 6 || parts[4] !== 'revisions') return true
  const schema = parts[2] === 'sources' ? sourceRevisionSchema : contracts[parts[2]]
  return !schema || schema.safeParse(contract(data)).success
}
