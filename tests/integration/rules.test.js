import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { createSpace, setSpaceArchived } from '../../src/data/firestore/spacesRepository.js'

let environment
const projectId = 'demo-memorizador-solar'
const uid = 'owner-user'
before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8') } })
})
beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'texts', 'legacy-text'), { userId: uid, title: 'Legado', rawText: 'Una idea.', type: 'prosa', chunks: [{ id: 'chunk_0', text: 'Una idea.', order: 0 }], createdAt: serverTimestamp() })
    await setDoc(doc(db, 'users', uid, 'sources', 'source'), { userId: uid, schemaVersion: 1, currentRevisionId: 'revision' })
    await setDoc(doc(db, 'users', uid, 'sources', 'source', 'revisions', 'revision'), { originalText: 'Una idea.' })
  })
})
after(async () => { await environment?.cleanup() })

test('propietario lee fuentes y revisiones privadas; otra cuenta y anónimo no', async () => {
  const owner = environment.authenticatedContext(uid).firestore()
  const other = environment.authenticatedContext('other-user').firestore()
  const anonymous = environment.unauthenticatedContext().firestore()
  await assertSucceeds(getDoc(doc(owner, 'users', uid, 'sources', 'source')))
  await assertSucceeds(getDoc(doc(owner, 'users', uid, 'sources', 'source', 'revisions', 'revision')))
  await assertSucceeds(getDocs(collection(owner, 'users', uid, 'sources')))
  await assertFails(getDoc(doc(other, 'users', uid, 'sources', 'source')))
  await assertFails(getDoc(doc(anonymous, 'users', uid, 'sources', 'source')))
})

test('cliente no crea, modifica ni elimina datos migrados o revisiones inmutables', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await assertFails(setDoc(doc(db, 'users', uid, 'sources', 'new'), { userId: uid }))
  await assertFails(setDoc(doc(db, 'users', uid, 'sources', 'source', 'revisions', 'revision'), { originalText: 'Alterado' }))
  await assertFails(deleteDoc(doc(db, 'users', uid, 'sources', 'source')))
})

test('cliente no ocupa loci, crea tarjetas/logs ni altera feature flags o bloqueo', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  for (const collectionId of ['microStations', 'encodings', 'cards', 'reviewEvents', 'migrationJobs', 'legacyLinks']) {
    await assertFails(setDoc(doc(db, 'users', uid, collectionId, 'forged'), { dueAt: 0, activeEncodingId: 'forged' }))
  }
  await assertFails(setDoc(doc(db, 'users', uid, 'settings', 'profile'), { icarusEnabled: true, legacyWritesLocked: false }))
})

test('sin bloqueo el repaso clásico sigue leyendo y escribiendo su progreso', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(getDocs(query(collection(db, 'texts'), where('userId', '==', uid))))
  await assertSucceeds(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 1, ease: 2.5, nextReview: 1700000000000 }))
  await assertSucceeds(getDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0')))
})

test('perfil existente desbloqueado conserva el clásico', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'settings', 'profile'), { schemaVersion: 1, icarusEnabled: false, legacyWritesLocked: false })
  })
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 2, ease: 2.5, nextReview: 1700000000000 }))
})

const spaceInput = (kind, extra = {}) => ({ kind, name: 'Claustro', cue: 'Puerta de piedra junto al jardín', ordinal: 0, sensoryCues: ['Piedra fría'], ...extra })
const spaceRef = (db, kind, id) => doc(db, 'users', uid, kind, id)
async function hierarchy(db) {
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  await createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro')
  await createSpace(db, uid, spaceInput('locus', { palaceId: 'palace', macroId: 'macro' }), 'locus')
}

test('jerarquía espacial transaccional: reintento idempotente, contadores concurrentes e historial exacto', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  const initial = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  await Promise.all(['macro-a', 'macro-b'].map((id) => createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), id)))
  const palace = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  assert.equal(palace.activeMacroCount, 2)
  assert.equal(palace.version, 3)
  assert.deepEqual((await getDoc(doc(spaceRef(db, 'palaces', 'palace'), 'revisions', 'v1'))).data(), initial)
  assert.equal((await getDocs(collection(spaceRef(db, 'palaces', 'palace'), 'revisions'))).size, 2)
  const retry = await createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro-a')
  assert.equal(retry.reused, true)
  assert.equal((await getDoc(spaceRef(db, 'palaces', 'palace'))).data().activeMacroCount, 2)
  await assert.rejects(createSpace(db, uid, spaceInput('macro', { palaceId: 'palace', name: 'Otro nombre' }), 'macro-a'), { code: 'intent-conflict' })
})

test('archivado reversible conserva IDs, originales y contadores sin borrar documentos', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const original = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: true, expectedVersion: 2 }), { code: 'space-in-use' })
  await setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 })
  assert.equal((await getDoc(spaceRef(db, 'macroStations', 'macro'))).data().activeLocusCount, 0)
  assert.deepEqual((await getDoc(doc(spaceRef(db, 'microStations', 'locus'), 'revisions', 'v1'))).data(), original)
  await setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: true, expectedVersion: 3 })
  await setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: true, expectedVersion: 3 })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: false, expectedVersion: 4 }), { code: 'archived-parent' })
  await setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: false, expectedVersion: 4 })
  await setSpaceArchived(db, uid, { kind: 'macro', id: 'macro', archived: false, expectedVersion: 4 })
  await setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: false, expectedVersion: 2 })
  const restored = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  assert.equal(restored.state, 'free')
  assert.equal(restored.anchorDescription, original.anchorDescription)
  assert.deepEqual(restored.createdAt, original.createdAt)
  assert.equal((await getDoc(spaceRef(db, 'palaces', 'palace'))).data().activeMacroCount, 1)
  assert.equal((await getDoc(spaceRef(db, 'macroStations', 'macro'))).data().activeLocusCount, 1)
  await assertFails(deleteDoc(spaceRef(db, 'microStations', 'locus')))
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 }), { code: 'version-conflict' })
})

test('reglas deniegan hijos huérfanos, doble hijo por contador, cruces de palacio e historial falso', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  await createSpace(db, uid, spaceInput('palace'), 'other-palace')
  const macro = (await getDoc(spaceRef(db, 'macroStations', 'macro'))).data()
  const palaceRef = spaceRef(db, 'palaces', 'palace')
  const palace = (await getDoc(palaceRef)).data()
  await assertFails(setDoc(spaceRef(db, 'macroStations', 'orphan'), { ...macro, id: 'orphan', version: 1, activeLocusCount: 0, createdAt: serverTimestamp() }))
  const double = writeBatch(db)
  double.set(doc(palaceRef, 'revisions', `v${palace.version}`), palace)
  double.update(palaceRef, { version: palace.version + 1, activeMacroCount: palace.activeMacroCount + 1, lastMutation: { action: 'create', childId: 'child-a' } })
  for (const id of ['child-a', 'child-b']) double.set(spaceRef(db, 'macroStations', id), { ...macro, id, version: 1, activeLocusCount: 0, lastMutation: null, createdAt: serverTimestamp() })
  await assertFails(double.commit())
  const locus = (await getDoc(spaceRef(db, 'microStations', 'locus'))).data()
  const crossed = writeBatch(db)
  crossed.set(doc(spaceRef(db, 'macroStations', 'macro'), 'revisions', `v${macro.version}`), macro)
  crossed.update(spaceRef(db, 'macroStations', 'macro'), { version: macro.version + 1, activeLocusCount: macro.activeLocusCount + 1, lastMutation: { action: 'create', childId: 'crossed' } })
  crossed.set(spaceRef(db, 'microStations', 'crossed'), { ...locus, id: 'crossed', palaceId: 'other-palace', createdAt: serverTimestamp() })
  await assertFails(crossed.commit())
  const forged = writeBatch(db)
  forged.set(doc(palaceRef, 'revisions', `v${palace.version}`), { ...palace, title: 'Historia inventada' })
  forged.update(palaceRef, { version: palace.version + 1, lifecycle: 'archived', activeMacroCount: 0 })
  await assertFails(forged.commit())
  await assertFails(updateDoc(palaceRef, { title: 'Ancla cambiada sin revisión' }))
  await assertFails(updateDoc(doc(palaceRef, 'revisions', 'v1'), { title: 'Historia alterada' }))
  await assertFails(deleteDoc(doc(palaceRef, 'revisions', 'v1')))
  const foreign = environment.authenticatedContext('other-user').firestore()
  await assertFails(getDocs(collection(foreign, 'users', uid, 'palaces')))
  await assertFails(getDoc(spaceRef(foreign, 'microStations', 'locus')))
  await assertFails(setDoc(spaceRef(foreign, 'palaces', 'forged'), { ...palace, id: 'forged', version: 1, activeMacroCount: 0, lastMutation: null, createdAt: serverTimestamp() }))
})

test('locus ocupado no se libera ni archiva; no se inventan contadores ni ocupaciones', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await hierarchy(db)
  const locusRef = spaceRef(db, 'microStations', 'locus')
  await assertFails(updateDoc(locusRef, { state: 'occupied', activeEncodingId: 'encoding' }))
  const palaceRef = spaceRef(db, 'palaces', 'palace')
  const palace = (await getDoc(palaceRef)).data()
  const batch = writeBatch(db)
  batch.set(doc(palaceRef, 'revisions', `v${palace.version}`), palace)
  batch.update(palaceRef, { activeMacroCount: 0, version: palace.version + 1 })
  await assertFails(batch.commit())
  await environment.withSecurityRulesDisabled(async (context) => { await updateDoc(spaceRef(context.firestore(), 'microStations', 'locus'), { state: 'occupied', activeEncodingId: 'encoding', usageCountLifetime: 1 }) })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: true, expectedVersion: 1 }), { code: 'space-in-use' })
  await assert.rejects(setSpaceArchived(db, uid, { kind: 'locus', id: 'locus', archived: false, expectedVersion: 1 }), { code: 'space-in-use' })
  const occupied = (await getDoc(locusRef)).data()
  const release = writeBatch(db)
  release.set(doc(locusRef, 'revisions', 'v1'), occupied)
  release.update(locusRef, { state: 'free', activeEncodingId: null, version: 2 })
  await assertFails(release.commit())
  assert.equal((await getDoc(locusRef)).data().activeEncodingId, 'encoding')
})

test('creación y archivado concurrentes no dejan una estación activa bajo un padre archivado', async () => {
  const db = environment.authenticatedContext(uid).firestore()
  await createSpace(db, uid, spaceInput('palace'), 'palace')
  const results = await Promise.allSettled([
    createSpace(db, uid, spaceInput('macro', { palaceId: 'palace' }), 'macro'),
    setSpaceArchived(db, uid, { kind: 'palace', id: 'palace', archived: true, expectedVersion: 1 }),
  ])
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1)
  const palace = (await getDoc(spaceRef(db, 'palaces', 'palace'))).data()
  const macro = await getDoc(spaceRef(db, 'macroStations', 'macro'))
  assert.equal(palace.activeMacroCount, macro.exists() ? 1 : 0)
  assert.equal(palace.lifecycle, macro.exists() ? 'active' : 'archived')
})

test('bloqueo confiable protege textos/progreso y sigue permitiendo respaldo de lectura', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', uid, 'settings', 'profile'), { schemaVersion: 1, icarusEnabled: false, legacyWritesLocked: true })
  })
  const db = environment.authenticatedContext(uid).firestore()
  await assertSucceeds(getDoc(doc(db, 'texts', 'legacy-text')))
  await assertSucceeds(getDocs(collection(db, 'texts', 'legacy-text', 'progress')))
  await assertFails(setDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0'), { interval: 1, ease: 2.5, nextReview: 1700000000000 }))
  await assertFails(deleteDoc(doc(db, 'texts', 'legacy-text')))
  await assertFails(deleteDoc(doc(db, 'texts', 'legacy-text', 'progress', 'chunk_0')))
  const snapshot = await getDoc(doc(db, 'texts', 'legacy-text'))
  assert.equal(snapshot.data().rawText, 'Una idea.')
})
