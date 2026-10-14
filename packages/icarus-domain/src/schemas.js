import { z } from 'zod'
import { timestampSchema, wireValueSchema } from './codec.js'
import { assertExactSourceSlice } from './segmentation.js'

export const SCHEMA_VERSION = 1
export const MIGRATION_VERSION = 1
export const idSchema = z.string().min(1).max(1500).refine((value) => !value.includes('/') && value !== '.' && value !== '..', 'ID de documento no válido.')
export const uidSchema = z.string().min(1).max(128).refine((value) => !value.includes('/') && value !== '.' && value !== '..', 'UID no válido.')
export const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
export const targetSchema = z.enum(['concept', 'explanation', 'verbatim', 'relation', 'transfer', 'order'])
export const ratingSchema = z.enum(['again', 'hard', 'good', 'easy'])
export const unitStatusSchema = z.enum(['imported', 'needs_concept', 'needs_encoding', 'ready', 'archived'])
export const edgeTypeSchema = z.enum(['causes', 'implies', 'contrasts', 'defines', 'example_of', 'depends_on', 'argument_order'])
const text = z.string().refine((value) => value.trim().length > 0, 'El texto no puede estar vacío.')
const version = z.number().int().positive().safe()
const base = { id: idSchema, userId: uidSchema, schemaVersion: z.literal(SCHEMA_VERSION), version, createdAt: timestampSchema }
const provenanceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('legacy'), textId: idSchema, backupHash: hashSchema }).strict(),
  z.object({ type: z.literal('user') }).strict(),
])

export const sourceSchema = z.object({
  ...base, title: text.max(120), kind: z.enum(['prose', 'poetry']),
  lifecycle: z.enum(['active', 'archived']), currentRevisionId: idSchema,
  provenance: provenanceSchema,
  creationRequestHash: hashSchema.optional(),
}).strict()

const sourceRevisionV1 = z.object({
  ...base, sourceId: idSchema, revisionNumber: version,
  originalText: text.max(60000), contentHash: hashSchema,
  hashAlgorithm: z.literal('sha256-canonical-json-v1'), language: z.string().min(1),
  segmentationMode: z.enum(['legacy', 'sentences', 'verses', 'stanzas', 'manual-reviewed']),
  provenance: provenanceSchema,
}).strict()

export const sourceRevisionSchema = z.union([sourceRevisionV1, sourceRevisionV1.extend({ schemaVersion: z.literal(2), edition: z.string().max(500), learningGoal: z.enum(['conceptual', 'literal', 'combined']), segmentationMode: z.enum(['sentences', 'verses', 'stanzas', 'paragraphs', 'manual-reviewed']) }).strict()])

export const unitSchema = z.object({
  ...base, sourceId: idSchema, sourceRevisionId: idSchema, unitRevision: version,
  ordinal: z.number().int().nonnegative().safe(), text, status: unitStatusSchema,
  startOffset: z.number().int().nonnegative().safe().nullable(),
  endOffset: z.number().int().positive().safe().nullable(),
  traceStatus: z.enum(['resolved', 'unresolved']),
  targetMode: z.enum(['conceptual', 'literal', 'dual']).nullable(),
  targets: z.array(targetSchema), primaryConceptId: idSchema.nullable(),
  legacyRef: z.object({ textId: idSchema, chunkId: idSchema }).strict().nullable(),
  activeEncodingId: idSchema.nullable().optional(),
}).strict().superRefine((unit, context) => {
  if (new Set(unit.targets).size !== unit.targets.length) context.addIssue({ code: 'custom', path: ['targets'], message: 'Objetivos duplicados.' })
  if (unit.traceStatus === 'resolved' && (unit.startOffset === null || unit.endOffset === null || unit.endOffset <= unit.startOffset)) {
    context.addIssue({ code: 'custom', path: ['startOffset'], message: 'Offsets incoherentes.' })
  }
  if (unit.traceStatus === 'unresolved' && (unit.startOffset !== null || unit.endOffset !== null)) {
    context.addIssue({ code: 'custom', path: ['traceStatus'], message: 'No inventar offsets para un fragmento no trazable.' })
  }
  if (unit.status === 'ready' && (!unit.primaryConceptId || !unit.targetMode || !unit.targets.length || unit.traceStatus !== 'resolved')) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'La unidad no puede estar lista sin objetivo, concepto y origen verificable.' })
  }
})

export const conceptSchema = z.object({
  ...base, canonicalProposition: text, kind: z.enum(['argument', 'definition', 'explanation', 'interpretation', 'sequence']),
  terms: z.array(text), premises: z.array(text), conclusion: z.string(), whyItFollows: z.string(),
  status: z.enum(['draft', 'reviewed', 'archived']),
  encodingId: idSchema.optional(),
}).strict().superRefine((concept, context) => {
  if (concept.status === 'reviewed' && concept.kind === 'argument' && (!concept.premises.length || !concept.conclusion.trim() || !concept.whyItFollows.trim())) {
    context.addIssue({ code: 'custom', path: ['status'], message: 'Un argumento revisado necesita premisas, conclusión y justificación.' })
  }
})

export const conceptEdgeSchema = z.object({
  ...base, fromConceptId: idSchema, toConceptId: idSchema, type: edgeTypeSchema,
  explanation: text, evidenceUnitIds: z.array(idSchema),
  encodingId: idSchema.optional(),
}).strict().refine((edge) => edge.fromConceptId !== edge.toConceptId, 'La relación no puede enlazar el concepto consigo mismo.')

const childMutationSchema = z.object({ action: z.enum(['create', 'archive', 'restore']), childId: idSchema }).strict().nullable()
const spaceMetadata = { creationRequestHash: hashSchema.optional() }
export const palaceSchema = z.object({ ...base, ...spaceMetadata, title: text.max(120), description: z.string().max(4000), lifecycle: z.enum(['active', 'archived']), activeMacroCount: z.number().int().nonnegative().max(1000000).default(0), lastMutation: childMutationSchema.default(null) }).strict()
export const macroStationSchema = z.object({
  ...base, ...spaceMetadata, palaceId: idSchema, name: text.max(120), ordinal: z.number().int().nonnegative().max(1000000),
  spatialCue: text.max(4000), lifecycle: z.enum(['active', 'archived']), activeLocusCount: z.number().int().nonnegative().max(1000000).default(0), lastMutation: childMutationSchema.default(null),
}).strict()
const locusObject = z.object({
  ...base, ...spaceMetadata, palaceId: idSchema, macroId: idSchema, name: text.max(120), anchorDescription: text.max(4000),
  sensoryCues: z.array(text.max(200)).max(6), ordinal: z.number().int().nonnegative().max(1000000),
  state: z.enum(['free', 'reserved', 'occupied', 'cooling', 'archived']),
  activeEncodingId: idSchema.nullable(), usageCountLifetime: z.number().int().nonnegative(),
}).strict()
export const locusSchema = z.union([locusObject, locusObject.extend({ schemaVersion: z.literal(2), activeBinding: z.object({ kind: z.literal('literal'), id: idSchema }).strict().nullable() }).strict()]).superRefine((locus, context) => {
  if ((locus.state === 'occupied') !== Boolean(locus.activeEncodingId || locus.activeBinding)) {
    context.addIssue({ code: 'custom', path: ['activeEncodingId'], message: 'Ocupación y codificación activa deben coincidir.' })
  }
})

export const sceneSchema = z.object({
  agent: text, action: text, symbol: text, distinctiveCue: text,
  sensoryDetails: z.array(text), conceptMapping: text,
}).strict()
export const qualityGateSchema = z.object({
  sourceReviewed: z.boolean(), objectiveSelected: z.boolean(),
  foundational: z.boolean(), foundationJustification: z.string(), linkedConceptId: idSchema.nullable(),
  sceneDistinguished: z.boolean(), initialRecallAttempted: z.boolean(), entranceExamPassed: z.boolean(),
  userConfirmedMeaning: z.boolean(),
}).strict()

export function passesEncodingGate(gate) {
  const result = qualityGateSchema.safeParse(gate)
  if (!result.success) return false
  const data = result.data
  return data.sourceReviewed && data.objectiveSelected && data.sceneDistinguished
    && data.initialRecallAttempted && data.entranceExamPassed && data.userConfirmedMeaning
    && (data.foundational ? Boolean(data.foundationJustification.trim()) : Boolean(data.linkedConceptId))
}

export const encodingSchema = z.object({
  ...base, unitId: idSchema, unitRevision: version, sourceRevisionId: idSchema,
  conceptId: idSchema, conceptVersion: version, locusId: idSchema, palaceId: idSchema, macroId: idSchema,
  scene: sceneSchema, retrievalPrompt: text, qualityGate: qualityGateSchema,
  status: z.enum(['validated', 'active', 'retired']),
  requestHash: hashSchema.optional(), draftId: idSchema.optional(),
  targets: z.array(z.enum(['concept', 'explanation', 'verbatim'])).min(1).max(3).optional(),
  edgeId: idSchema.nullable().optional(),
}).strict().refine((encoding) => encoding.status === 'retired' || passesEncodingGate(encoding.qualityGate), 'No se activa una codificación sin superar el Taller.')

// scheduler.js valida la serialización completa y rechaza versiones desconocidas.
// El codec 2 usa JSON tipado para evitar arrays anidados en documentos Firestore.
export const schedulerEnvelopeSchema = z.object({
  algorithm: z.literal('fsrs'), packageVersion: text, codecVersion: version,
  state: z.enum(['new', 'learning', 'review', 'relearning']), snapshot: z.union([wireValueSchema, z.string().max(20000)]),
}).strict().refine((scheduler) => typeof scheduler.snapshot === 'string' ? scheduler.codecVersion === 2 : scheduler.snapshot.type === 'map', 'Codec de scheduler no válido.')

export const cardSchema = z.object({
  ...base, unitId: idSchema, encodingId: idSchema, encodingVersion: version, target: targetSchema,
  lifecycle: z.enum(['active', 'suspended', 'archived']), scheduler: schedulerEnvelopeSchema,
  dueAt: timestampSchema, lastReviewedAt: timestampSchema.nullable(),
  lastEventId: idSchema.nullable().optional(),
}).strict()

export const reviewEventSchema = z.object({
  ...base, cardId: idSchema, target: targetSchema, clientRequestId: idSchema, requestHash: hashSchema,
  rating: ratingSchema, highestHint: z.number().int().min(0).max(3),
  attemptedBeforeReveal: z.boolean(), previousCardVersion: version, newCardVersion: version,
  reviewedAt: timestampSchema, dueBefore: timestampSchema, dueAfter: timestampSchema,
  responseRetention: z.enum(['metadata-only', 'opt-in']), attemptText: z.string().optional(),
  successfulRecall: z.boolean().optional(), noCriticalError: z.boolean().optional(),
  stageCompletion: z.object({ scene: z.boolean(), meaning: z.boolean(), structure: z.boolean(), verbatim: z.boolean() }).strict().optional(),
  schedulerBefore: schedulerEnvelopeSchema.optional(), schedulerAfter: schedulerEnvelopeSchema.optional(),
}).strict().superRefine((event, context) => {
  if (event.newCardVersion !== event.previousCardVersion + 1) context.addIssue({ code: 'custom', path: ['newCardVersion'], message: 'Versión de evento incoherente.' })
  if (event.responseRetention === 'metadata-only' && event.attemptText !== undefined) context.addIssue({ code: 'custom', path: ['attemptText'], message: 'No conservar respuestas sin consentimiento.' })
})

export const profileSchema = z.object({
  schemaVersion: z.literal(1), icarusEnabled: z.boolean(), legacyWritesLocked: z.boolean(),
}).strict()

export const legacyTextSchema = z.object({
  userId: uidSchema, title: text.max(120), rawText: text.max(60000), type: z.enum(['prosa', 'poesia']),
  chunks: z.array(z.object({ id: idSchema, text, order: z.number().int().nonnegative().safe() }).passthrough()).min(1).max(1000),
}).passthrough().superRefine((source, context) => {
  const ids = source.chunks.map((chunk) => chunk.id)
  const orders = source.chunks.map((chunk) => chunk.order)
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['chunks'], message: 'IDs de fragmento duplicados.' })
  if (new Set(orders).size !== orders.length) context.addIssue({ code: 'custom', path: ['chunks'], message: 'Órdenes de fragmento duplicados.' })
})

export function validateUnitAgainstRevision(unit, revision) {
  const parsedUnit = unitSchema.parse(unit)
  const parsedRevision = sourceRevisionSchema.parse(revision)
  if (parsedUnit.userId !== parsedRevision.userId || parsedUnit.sourceId !== parsedRevision.sourceId || parsedUnit.sourceRevisionId !== parsedRevision.id) {
    throw new Error('La unidad referencia otra fuente, revisión o propietario.')
  }
  if (parsedUnit.traceStatus === 'resolved') assertExactSourceSlice(parsedRevision, parsedUnit)
  return true
}
