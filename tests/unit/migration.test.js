import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canonicalJson, decodeValue, encodeValue, hashValue, PortableFirestoreValue } from '@icarus/domain/codec'
import { applyPlanToMemory, createLegacyBackup, createMigrationPlan, MemoryMigrationStore, restoreBackupToMemory, simulateMigration, verifyLegacyBackup } from '@icarus/domain/migration'
import { runLocalCommand } from '../../scripts/icarus-migrate.mjs'

const fixture = JSON.parse(await readFile(new URL('../fixtures/legacy-v1.json', import.meta.url), 'utf8'))
const input = () => structuredClone(fixture)

test('respaldo tipado: conserva valores, símbolos de tipos y claves especiales sin contaminación de prototipo', () => {
  const data = JSON.parse('{"__proto__":{"polluted":true},"constructor":"valor","type":"timestamp","value":4}')
  data.nan = NaN; data.negativeZero = -0; data.infinity = Infinity
  data.timestamp = new PortableFirestoreValue({ type: 'timestamp', value: { seconds: 1700000000, nanoseconds: 123456789 } })
  const encoded = encodeValue(data)
  const decoded = decodeValue(encoded)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(Object.hasOwn(decoded, '__proto__'), true)
  assert.equal(decoded.constructor, 'valor')
  assert.equal(Number.isNaN(decoded.nan), true)
  assert.equal(Object.is(decoded.negativeZero, -0), true)
  assert.equal(decoded.infinity, Infinity)
  assert.equal(canonicalJson(encodeValue(decoded)), canonicalJson(encoded))
})

test('respaldo: tipos no serializables, ciclos y arrays incompletos fallan sin perder campos', () => {
  const cyclic = {}; cyclic.child = cyclic
  assert.throws(() => encodeValue(cyclic), /circular/)
  assert.throws(() => encodeValue({ missing: undefined }), /representable/)
  assert.throws(() => encodeValue(new Map()), /compatible/)
  assert.throws(() => encodeValue(new Array(2)), /incompleto/)
})

test('respaldo: verifica manifiesto, hashes y ownership sin modificar el inventario', async () => {
  const dataset = input(); const before = structuredClone(dataset)
  const backup = await createLegacyBackup(dataset)
  assert.deepEqual(dataset, before)
  assert.equal(backup.manifest.textCount, 2)
  assert.equal(backup.manifest.progressCount, 2)
  await verifyLegacyBackup(JSON.parse(JSON.stringify(backup)), fixture.userId)
  await assert.rejects(verifyLegacyBackup(backup, 'other-user'), (error) => error.code === 'ownership')
  backup.records[0].data.value.push(['altered', { type: 'boolean', value: true }])
  await assert.rejects(verifyLegacyBackup(backup), (error) => error.code === 'hash-mismatch')
})

test('inventario: rechaza mezcla de usuarios e IDs repetidos antes de exportar', async () => {
  const mixed = input(); mixed.records[0].data.userId = 'other-user'
  await assert.rejects(createLegacyBackup(mixed), (error) => error.code === 'ownership')
  const duplicate = input(); duplicate.records.push(duplicate.records[0])
  await assert.rejects(createLegacyBackup(duplicate), (error) => error.code === 'duplicate-id')
  const missing = input(); delete missing.records[0].progress
  await assert.rejects(createLegacyBackup(missing), (error) => error.code === 'missing-progress')
})

test('migración: preserva exactamente espacios/CRLF y no equipara chunk_0 de fuentes distintas', async () => {
  const backup = await createLegacyBackup(input())
  const plan = await createMigrationPlan(backup)
  const sources = plan.documents.filter((document) => document.kind === 'source')
  assert.equal(sources.length, 2)
  const poem = sources.find((source) => source.data.kind === 'poetry')
  const revision = plan.documents.find((document) => document.kind === 'sourceRevision' && document.data.sourceId === poem.data.id)
  assert.equal(revision.data.originalText, fixture.records[0].data.rawText)
  const repeatedIds = plan.documents.filter((document) => document.kind === 'unit' && document.data.legacyRef.chunkId === 'chunk_0')
  assert.equal(repeatedIds.length, 2)
  assert.notEqual(repeatedIds[0].data.id, repeatedIds[1].data.id)
  assert.equal(plan.summary.cardCount, 0)
  for (const unit of plan.documents.filter((document) => document.kind === 'unit')) {
    assert.equal(unit.data.status, 'needs_concept'); assert.deepEqual(unit.data.targets, [])
    assert.equal(unit.data.primaryConceptId, null)
  }
})

test('restauración + segunda ejecución: no cambian legados ni duplican documentos', async () => {
  const backup = await createLegacyBackup(input())
  const result = await simulateMigration(backup)
  assert.equal(result.verification.restoreVerified, true)
  assert.equal(result.verification.legacyPreserved, true)
  assert.equal(result.verification.secondRunCreated, 0)
  const original = result.documents.find((document) => document.path === 'texts/poem')
  assert.equal(decodeValue(original.data).rawText, fixture.records[0].data.rawText)
  const progress = result.documents.find((document) => document.path === 'texts/poem/progress/chunk_0')
  assert.deepEqual(decodeValue(progress.data), fixture.records[0].progress[0].data)
})

test('checkpoint: una interrupción puede reanudarse con el mismo plan', async () => {
  const backup = await createLegacyBackup(input())
  const { store } = await restoreBackupToMemory(backup)
  const plan = await createMigrationPlan(backup)
  const interrupted = await applyPlanToMemory(plan, store, { batchSize: 2, interruptAfterBatches: 1 })
  assert.equal(interrupted.status, 'interrupted')
  const resumed = await applyPlanToMemory(plan, store, { batchSize: 2, checkpoint: interrupted.checkpoint })
  assert.equal(resumed.status, 'completed')
  assert.equal((await applyPlanToMemory(plan, store)).created, 0)
  await assert.rejects(applyPlanToMemory(plan, new MemoryMigrationStore(), { checkpoint: interrupted.checkpoint }), (error) => error.code === 'invalid-checkpoint')
})

test('inmutabilidad: conflicto existente bloquea antes de añadir documentos nuevos', async () => {
  const backup = await createLegacyBackup(input()); const plan = await createMigrationPlan(backup)
  const store = new MemoryMigrationStore()
  store.createBatch([{ path: plan.documents[0].path, data: { different: true } }])
  const before = store.dump()
  await assert.rejects(applyPlanToMemory(plan, store), (error) => error.code === 'immutable-conflict')
  assert.deepEqual(store.dump(), before)
})

test('datos no trazables y progreso huérfano se conservan con advertencias explícitas', async () => {
  const dataset = input(); dataset.records[0].data.chunks[0].text = 'Verso que no aparece en la fuente'
  dataset.records[0].progress.push({ chunkId: 'chunk_99', data: { strange: 'preservar', interval: NaN } })
  const backup = await createLegacyBackup(dataset); const plan = await createMigrationPlan(backup)
  assert.equal(plan.summary.unresolvedCount, 1)
  assert.equal(plan.summary.legacyProgressCount, 3)
  const unit = plan.documents.find((document) => document.kind === 'unit' && document.data.traceStatus === 'unresolved')
  assert.equal(unit.data.text, 'Verso que no aparece en la fuente'); assert.equal(unit.data.startOffset, null)
  assert.equal(plan.issues.some((issue) => issue.code === 'ORPHAN_PROGRESS'), true)
  const result = await simulateMigration(backup)
  assert.equal(result.verification.legacyPreserved, true)
})

test('datos corruptos bloquean aplicación; el respaldo no descarta los fragmentos', async () => {
  const dataset = input(); dataset.records[0].data.chunks[1].id = 'chunk_0'
  const backup = await createLegacyBackup(dataset); const plan = await createMigrationPlan(backup)
  assert.equal(plan.summary.blockerCount, 1)
  assert.equal(decodeValue(backup.records.find((record) => record.textId === 'poem').data).chunks.length, 2)
  const store = new MemoryMigrationStore()
  await assert.rejects(applyPlanToMemory(plan, store), (error) => error.code === 'blocked-plan')
  assert.equal(store.dump().length, 0)
})

test('plan alterado y destinos ajenos se rechazan; no existe escritor de producción', async () => {
  const backup = await createLegacyBackup(input()); const plan = await createMigrationPlan(backup)
  await assert.rejects(applyPlanToMemory(plan, {}), (error) => error.code === 'local-only')
  const modified = structuredClone(plan); modified.documents[0].path = 'users/other-user/sources/fake'
  await assert.rejects(applyPlanToMemory(modified, new MemoryMigrationStore()), (error) => error.code === 'plan-hash-mismatch')
  const { planHash: _planHash, ...body } = modified
  modified.planHash = await hashValue(body)
  await assert.rejects(applyPlanToMemory(modified, new MemoryMigrationStore()), (error) => error.code === 'ownership')
  await assert.rejects(runLocalCommand('apply-production', backup), (error) => error.code === 'invalid-command')
})

test('referencias rotas y manifiesto inconsistente se rechazan aunque se recalcule el hash', async () => {
  const backup = await createLegacyBackup(input())
  for (const change of [
    (plan) => { plan.documents = plan.documents.filter((document) => document.kind !== 'sourceRevision') },
    (plan) => { plan.summary.unitCount += 1 },
    (plan) => { plan.documents.find((document) => document.kind === 'legacyLink').data.unitId = 'missing' },
  ]) {
    const plan = await createMigrationPlan(backup); change(plan)
    const { planHash: _planHash, ...body } = plan
    plan.planHash = await hashValue(body)
    await assert.rejects(applyPlanToMemory(plan, new MemoryMigrationStore()))
  }
})

test('captura no coordinada queda identificada; simulación nunca equivale a migración real', async () => {
  const dataset = input(); dataset.consistency = 'uncoordinated'
  const backup = await createLegacyBackup(dataset); const plan = await createMigrationPlan(backup)
  assert.equal(plan.mode, 'local-simulation')
  assert.equal(plan.issues.some((issue) => issue.code === 'UNCOORDINATED_CAPTURE'), true)
  const restored = await runLocalCommand('restore', backup, fixture.userId)
  assert.equal(restored.mode, 'local-memory-restore')
  assert.equal(restored.restoredDocumentCount, 4)
})
