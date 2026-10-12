import { z } from 'zod'
import { canonicalJson, decodeValue, encodeValue, hashValue, toTimestamp, timestampSchema, wireValueSchema } from './codec.js'
import { hashSchema, idSchema, legacyTextSchema, MIGRATION_VERSION, sourceRevisionSchema, sourceSchema, uidSchema, unitSchema, validateUnitAgainstRevision } from './schemas.js'
import { locateLegacyFragments } from './segmentation.js'

const progressRecordSchema = z.object({ chunkId: idSchema, data: wireValueSchema }).strict()
const recordSchema = z.object({ textId: idSchema, data: wireValueSchema, progress: z.array(progressRecordSchema) }).strict()
const digestEntrySchema = z.object({ textId: idSchema, hash: hashSchema, progressHashes: z.array(z.object({ chunkId: idSchema, hash: hashSchema }).strict()) }).strict()
const backupBodySchema = z.object({
  format: z.literal('icarus-legacy-backup'), formatVersion: z.literal(1), migrationVersion: z.literal(MIGRATION_VERSION),
  backupId: idSchema, userId: uidSchema, capturedAt: timestampSchema,
  consistency: z.enum(['fixture', 'uncoordinated', 'write-frozen', 'point-in-time']),
  records: z.array(recordSchema),
  manifest: z.object({ textCount: z.number().int().nonnegative(), progressCount: z.number().int().nonnegative(), recordHashes: z.array(digestEntrySchema) }).strict(),
}).strict()
const backupSchema = backupBodySchema.extend({ backupHash: hashSchema })

export class MigrationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MigrationError'; this.code = code; this.details = details }
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new MigrationError('duplicate-id', `El respaldo contiene IDs duplicados: ${label}.`)
}

async function manifestFor(records) {
  const recordHashes = []
  for (const record of records) {
    assertUnique(record.progress.map((entry) => entry.chunkId), 'progreso')
    recordHashes.push({ textId: record.textId, hash: await hashValue(record.data), progressHashes: await Promise.all(record.progress.map(async (entry) => ({ chunkId: entry.chunkId, hash: await hashValue(entry.data) }))) })
  }
  return { textCount: records.length, progressCount: records.reduce((count, record) => count + record.progress.length, 0), recordHashes }
}

export async function createLegacyBackup({ userId, records, capturedAt = Date.now(), consistency = 'uncoordinated', backupId = crypto.randomUUID() }, adapter = {}) {
  uidSchema.parse(userId)
  if (!Array.isArray(records)) throw new MigrationError('invalid-records', 'El inventario no es una lista de textos.')
  const encoded = records.map((record) => {
    idSchema.parse(record?.textId)
    if (record?.data?.userId !== userId) throw new MigrationError('ownership', 'El inventario contiene datos de otra cuenta o sin propietario.')
    if (!Array.isArray(record.progress)) throw new MigrationError('missing-progress', 'El inventario debe incluir el progreso de cada texto, aunque esté vacío.')
    return recordSchema.parse({ textId: record.textId, data: encodeValue(record.data, adapter), progress: record.progress.map((entry) => ({ chunkId: entry.chunkId, data: encodeValue(entry.data, adapter) })) })
  }).sort((a, b) => a.textId.localeCompare(b.textId))
  for (const record of encoded) record.progress.sort((a, b) => a.chunkId.localeCompare(b.chunkId))
  assertUnique(encoded.map((record) => record.textId), 'textos')
  const body = backupBodySchema.parse({
    format: 'icarus-legacy-backup', formatVersion: 1, migrationVersion: MIGRATION_VERSION,
    backupId, userId, capturedAt: toTimestamp(capturedAt), consistency, records: encoded,
    manifest: await manifestFor(encoded),
  })
  return { ...body, backupHash: await hashValue(body) }
}

export async function verifyLegacyBackup(input, expectedUserId) {
  const backup = backupSchema.parse(input)
  if (expectedUserId !== undefined && backup.userId !== expectedUserId) throw new MigrationError('ownership', 'El respaldo pertenece a otra cuenta.')
  assertUnique(backup.records.map((record) => record.textId), 'textos')
  for (const record of backup.records) {
    if (record.data.type !== 'map' || decodeValue(record.data)?.userId !== backup.userId) throw new MigrationError('ownership', 'El propietario de un documento no coincide con el respaldo.')
    for (const entry of record.progress) {
      if (entry.data.type !== 'map') throw new MigrationError('invalid-progress', 'Un documento de progreso no es un mapa Firestore.')
    }
  }
  const { backupHash, ...body } = backup
  if (await hashValue(body) !== backupHash) throw new MigrationError('hash-mismatch', 'El respaldo fue alterado o está incompleto: su hash no coincide.')
  if (canonicalJson(await manifestFor(backup.records)) !== canonicalJson(backup.manifest)) throw new MigrationError('manifest-mismatch', 'Los hashes o conteos del manifiesto no coinciden.')
  return backup
}

async function stableId(type, ...identity) {
  const hash = await hashValue({ namespace: 'icarus-migration-v1', type, identity })
  return `${type}_${hash.slice(7, 39)}`
}

export async function createMigrationPlan(input, expectedUserId) {
  const backup = await verifyLegacyBackup(input, expectedUserId)
  const root = `users/${backup.userId}`
  const documents = []
  const issues = []
  let unitCount = 0
  let sourceCount = 0
  let unresolvedCount = 0
  if (backup.consistency === 'uncoordinated') issues.push({ severity: 'warning', code: 'UNCOORDINATED_CAPTURE', textId: null, message: 'La captura no es un snapshot atómico. No autoriza una migración real.' })

  for (const record of backup.records) {
    for (const progress of record.progress) {
      const id = await stableId('progress', backup.userId, record.textId, progress.chunkId)
      documents.push({ kind: 'legacyProgress', path: `${root}/legacyProgress/${id}`, data: { id, schemaVersion: 1, userId: backup.userId, backupHash: backup.backupHash, capturedAt: backup.capturedAt, legacyRef: { textId: record.textId, chunkId: progress.chunkId }, data: progress.data } })
    }
    const raw = decodeValue(record.data)
    const validation = legacyTextSchema.safeParse(raw)
    if (!validation.success) {
      issues.push({ severity: 'blocker', code: 'INVALID_LEGACY_SOURCE', textId: record.textId, message: 'El texto legado necesita revisión; el respaldo conserva todos sus datos.', fields: validation.error.issues.map((issue) => issue.path.join('.')) })
      continue
    }
    const legacy = validation.data
    const sourceId = await stableId('source', backup.userId, record.textId)
    const contentHash = await hashValue(legacy.rawText)
    const revisionId = await stableId('revision', sourceId, contentHash)
    const common = { userId: backup.userId, schemaVersion: 1, version: 1, createdAt: backup.capturedAt }
    const provenance = { type: 'legacy', textId: record.textId, backupHash: backup.backupHash }
    const source = sourceSchema.parse({ ...common, id: sourceId, title: legacy.title, kind: legacy.type === 'poesia' ? 'poetry' : 'prose', lifecycle: 'active', currentRevisionId: revisionId, provenance })
    const revision = sourceRevisionSchema.parse({ ...common, id: revisionId, sourceId, revisionNumber: 1, originalText: legacy.rawText, contentHash, hashAlgorithm: 'sha256-canonical-json-v1', language: typeof raw.language === 'string' && raw.language.trim() ? raw.language : 'und', segmentationMode: 'legacy', provenance })
    documents.push({ kind: 'source', path: `${root}/sources/${sourceId}`, data: source }, { kind: 'sourceRevision', path: `${root}/sources/${sourceId}/revisions/${revisionId}`, data: revision })
    sourceCount += 1
    const chunks = [...legacy.chunks].sort((a, b) => a.order - b.order)
    const locations = locateLegacyFragments(legacy.rawText, chunks)
    for (let position = 0; position < chunks.length; position += 1) {
      const chunk = chunks[position]
      const unitId = await stableId('unit', backup.userId, record.textId, chunk.id)
      const unit = unitSchema.parse({ ...common, id: unitId, sourceId, sourceRevisionId: revisionId, unitRevision: 1, ordinal: chunk.order, text: chunk.text, status: 'needs_concept', ...locations[position], targetMode: null, targets: [], primaryConceptId: null, legacyRef: { textId: record.textId, chunkId: chunk.id } })
      validateUnitAgainstRevision(unit, revision)
      documents.push({ kind: 'unit', path: `${root}/units/${unitId}`, data: unit }, { kind: 'unitRevision', path: `${root}/units/${unitId}/revisions/1`, data: unit })
      const linkId = await stableId('link', backup.userId, record.textId, chunk.id)
      documents.push({ kind: 'legacyLink', path: `${root}/legacyLinks/${linkId}`, data: { id: linkId, schemaVersion: 1, userId: backup.userId, legacyRef: unit.legacyRef, sourceId, sourceRevisionId: revisionId, unitId, backupHash: backup.backupHash } })
      if (unit.traceStatus === 'unresolved') {
        unresolvedCount += 1
        issues.push({ severity: 'warning', code: 'UNRESOLVED_FRAGMENT', textId: record.textId, chunkId: chunk.id, message: 'Fragmento preservado sin offsets inventados. Necesita revisar su origen antes de codificar.' })
      }
      unitCount += 1
    }
    const chunkIds = new Set(chunks.map((chunk) => chunk.id))
    for (const progress of record.progress) {
      if (!chunkIds.has(progress.chunkId)) issues.push({ severity: 'warning', code: 'ORPHAN_PROGRESS', textId: record.textId, chunkId: progress.chunkId, message: 'Progreso sin fragmento correspondiente; se conserva íntegro en legacyProgress.' })
    }
  }
  const summary = { sourceCount, unitCount, unresolvedCount, legacyProgressCount: backup.manifest.progressCount, cardCount: 0, blockerCount: issues.filter((issue) => issue.severity === 'blocker').length }
  const jobId = await stableId('job', backup.userId, backup.backupHash)
  documents.push({ kind: 'migrationJob', path: `${root}/migrationJobs/${jobId}`, data: { id: jobId, schemaVersion: 1, migrationVersion: MIGRATION_VERSION, userId: backup.userId, status: 'planned', backupHash: backup.backupHash, summary } })
  documents.sort((a, b) => a.path.localeCompare(b.path))
  const body = { format: 'icarus-local-migration-plan', formatVersion: 1, migrationVersion: MIGRATION_VERSION, mode: 'local-simulation', userId: backup.userId, backupHash: backup.backupHash, documents, issues, summary }
  return { ...body, planHash: await hashValue(body) }
}

export class MemoryMigrationStore {
  #documents = new Map()
  get(path) { return this.#documents.has(path) ? structuredClone(this.#documents.get(path)) : undefined }
  dump() { return Array.from(this.#documents, ([path, data]) => ({ path, data: structuredClone(data) })).sort((a, b) => a.path.localeCompare(b.path)) }
  createBatch(documents) {
    assertUnique(documents.map((document) => document.path), 'operaciones')
    for (const document of documents) {
      const previous = this.#documents.get(document.path)
      if (previous !== undefined && canonicalJson(previous) !== canonicalJson(document.data)) throw new MigrationError('immutable-conflict', 'Un documento existente difiere del plan; no se sobrescribirá.', { path: document.path })
    }
    let created = 0
    for (const document of documents) {
      if (!this.#documents.has(document.path)) { this.#documents.set(document.path, structuredClone(document.data)); created += 1 }
    }
    return created
  }
}

export async function restoreBackupToMemory(input, store = new MemoryMigrationStore(), expectedUserId) {
  if (!(store instanceof MemoryMigrationStore)) throw new MigrationError('local-only', 'La restauración de esta fase solo admite almacenamiento local en memoria.')
  const backup = await verifyLegacyBackup(input, expectedUserId)
  const documents = backup.records.flatMap((record) => [
    { path: `texts/${record.textId}`, data: record.data },
    ...record.progress.map((progress) => ({ path: `texts/${record.textId}/progress/${progress.chunkId}`, data: progress.data })),
  ])
  const created = store.createBatch(documents)
  return { store, restoredDocumentCount: documents.length, created }
}

export async function verifyMigrationPlan(input) {
  if (!input || input.format !== 'icarus-local-migration-plan' || input.formatVersion !== 1 || input.migrationVersion !== 1 || input.mode !== 'local-simulation') throw new MigrationError('invalid-plan', 'Formato de plan no compatible.')
  uidSchema.parse(input.userId); hashSchema.parse(input.backupHash); hashSchema.parse(input.planHash)
  const { planHash, ...body } = input
  if (await hashValue(body) !== planHash) throw new MigrationError('plan-hash-mismatch', 'El plan fue alterado o está incompleto.')
  if (!Array.isArray(input.documents) || !Array.isArray(input.issues)) throw new MigrationError('invalid-plan', 'Plan incompleto.')
  assertUnique(input.documents.map((document) => document.path), 'documentos del plan')
  const prefix = `users/${input.userId}/`
  const revisions = new Map()
  const sources = new Map()
  const units = new Map()
  for (const document of input.documents) {
    if (!document.path.startsWith(prefix) || document.data?.userId !== input.userId || document.data?.schemaVersion !== 1) throw new MigrationError('ownership', 'El plan cruza propietarios o versiones de esquema.')
    const parts = document.path.slice(prefix.length).split('/')
    for (const part of parts) idSchema.parse(part)
    if (document.kind === 'source' && parts.length === 2 && parts[0] === 'sources' && parts[1] === document.data.id) {
      sourceSchema.parse(document.data); sources.set(document.data.id, document.data)
    }
    else if (document.kind === 'sourceRevision' && parts.length === 4 && parts[0] === 'sources' && parts[2] === 'revisions' && parts[1] === document.data.sourceId && parts[3] === document.data.id) {
      sourceRevisionSchema.parse(document.data)
      if (await hashValue(document.data.originalText) !== document.data.contentHash) throw new MigrationError('content-hash-mismatch', 'El texto de una revisión fue alterado.')
      revisions.set(document.data.id, document.data)
    } else if (document.kind === 'unit' && parts.length === 2 && parts[0] === 'units' && parts[1] === document.data.id) {
      unitSchema.parse(document.data); units.set(document.data.id, document.data)
    }
    else if (document.kind === 'unitRevision' && parts.length === 4 && parts[0] === 'units' && parts[2] === 'revisions' && parts[1] === document.data.id && parts[3] === '1') unitSchema.parse(document.data)
    else if (document.kind === 'legacyProgress' && parts.length === 2 && parts[0] === 'legacyProgress' && parts[1] === document.data.id) {
      wireValueSchema.parse(document.data.data)
      idSchema.parse(document.data.legacyRef?.textId); idSchema.parse(document.data.legacyRef?.chunkId)
    } else if (document.kind === 'legacyLink' && parts.length === 2 && parts[0] === 'legacyLinks' && parts[1] === document.data.id) {
      idSchema.parse(document.data.sourceId); idSchema.parse(document.data.sourceRevisionId); idSchema.parse(document.data.unitId)
    } else if (!(document.kind === 'migrationJob' && parts.length === 2 && parts[0] === 'migrationJobs' && parts[1] === document.data.id && document.data.migrationVersion === 1 && document.data.status === 'planned')) throw new MigrationError('forbidden-operation', 'El plan contiene una operación fuera del alcance de esta fase.')
  }
  for (const source of sources.values()) {
    if (revisions.get(source.currentRevisionId)?.sourceId !== source.id) throw new MigrationError('broken-reference', 'Una fuente no tiene su revisión inmutable.')
  }
  for (const revision of revisions.values()) {
    if (!sources.has(revision.sourceId)) throw new MigrationError('broken-reference', 'Una revisión no tiene su fuente.')
  }
  for (const document of input.documents.filter((document) => ['unit', 'unitRevision'].includes(document.kind))) {
    validateUnitAgainstRevision(document.data, revisions.get(document.data.sourceRevisionId))
    if (!sources.has(document.data.sourceId) || !units.has(document.data.id)) throw new MigrationError('broken-reference', 'Una unidad no tiene fuente o entidad principal.')
    if (document.kind === 'unitRevision' && canonicalJson(document.data) !== canonicalJson(units.get(document.data.id))) throw new MigrationError('revision-mismatch', 'La revisión de una unidad no coincide con el contenido migrado.')
    if (document.data.status !== 'needs_concept' || document.data.targets.length || document.data.primaryConceptId) throw new MigrationError('premature-activation', 'La migración no puede activar objetivos ni inventar comprensión.')
  }
  const links = input.documents.filter((document) => document.kind === 'legacyLink')
  for (const link of links) {
    const unit = units.get(link.data.unitId)
    if (!unit || link.data.sourceId !== unit.sourceId || link.data.sourceRevisionId !== unit.sourceRevisionId || canonicalJson(link.data.legacyRef) !== canonicalJson(unit.legacyRef)) throw new MigrationError('broken-reference', 'Una correspondencia legada apunta a otra unidad.')
  }
  const progressCount = input.documents.filter((document) => document.kind === 'legacyProgress').length
  if (input.summary?.sourceCount !== sources.size || input.summary?.unitCount !== units.size || input.summary?.legacyProgressCount !== progressCount
    || input.summary?.cardCount !== 0 || links.length !== units.size
    || input.summary?.blockerCount !== input.issues.filter((issue) => issue.severity === 'blocker').length) throw new MigrationError('manifest-mismatch', 'Los conteos del plan no coinciden con sus documentos.')
  return input
}

export async function applyPlanToMemory(input, store, { batchSize = 200, checkpoint = null, interruptAfterBatches = Infinity } = {}) {
  if (!(store instanceof MemoryMigrationStore)) throw new MigrationError('local-only', 'No hay un escritor para Firebase real en esta fase.')
  const plan = await verifyMigrationPlan(input)
  if (plan.issues.some((issue) => issue.severity === 'blocker')) throw new MigrationError('blocked-plan', 'El plan tiene datos que requieren revisión; no se aplicará parcialmente.')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400) throw new MigrationError('invalid-batch', 'Tamaño de lote no válido.')
  const start = checkpoint?.nextIndex ?? 0
  if (!Number.isInteger(start) || start < 0 || start > plan.documents.length || (checkpoint && checkpoint.planHash !== plan.planHash)) throw new MigrationError('invalid-checkpoint', 'El checkpoint no corresponde a este plan.')
  for (let index = 0; index < plan.documents.length; index += 1) {
    const document = plan.documents[index]
    const previous = store.get(document.path)
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(document.data)) throw new MigrationError('immutable-conflict', 'Una revisión existente no puede sobrescribirse.', { path: document.path })
    if (index < start && previous === undefined) throw new MigrationError('invalid-checkpoint', 'El checkpoint apunta a documentos que todavía no existen.')
  }
  let created = 0
  let batches = 0
  for (let index = start; index < plan.documents.length; index += batchSize) {
    if (batches >= interruptAfterBatches) return { status: 'interrupted', created, checkpoint: { planHash: plan.planHash, nextIndex: index } }
    created += store.createBatch(plan.documents.slice(index, index + batchSize))
    batches += 1
  }
  return { status: 'completed', created, documentCount: plan.documents.length, checkpoint: { planHash: plan.planHash, nextIndex: plan.documents.length } }
}

export async function simulateMigration(input, expectedUserId) {
  const backup = await verifyLegacyBackup(input, expectedUserId)
  const restored = await restoreBackupToMemory(backup, undefined, expectedUserId)
  const before = await hashValue(restored.store.dump())
  const plan = await createMigrationPlan(backup, expectedUserId)
  const first = await applyPlanToMemory(plan, restored.store)
  const afterFirst = restored.store.dump()
  const second = await applyPlanToMemory(plan, restored.store)
  const legacyDocuments = restored.store.dump().filter((document) => document.path.startsWith('texts/'))
  if (await hashValue(legacyDocuments) !== before || second.created !== 0 || canonicalJson(afterFirst) !== canonicalJson(restored.store.dump())) throw new MigrationError('verification-failed', 'Falló la comprobación de restauración, preservación o idempotencia.')
  return { mode: 'local-simulation', backupHash: backup.backupHash, planHash: plan.planHash, summary: plan.summary, verification: { legacyPreserved: true, restoreVerified: true, secondRunCreated: second.created }, first, documents: afterFirst, issues: plan.issues }
}
