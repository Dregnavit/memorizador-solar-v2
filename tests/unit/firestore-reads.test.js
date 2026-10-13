import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { requiredPrivateIndexes } from '../../src/data/firestore/privateQueries.js'
import { emptyReadState, failedReadState, loadingReadState, snapshotReadState, subscribePrivateRead } from '../../src/data/firestore/readState.js'

const schema = z.object({ id: z.string(), userId: z.string(), createdAt: z.number() })
const contract = (raw) => raw
const entry = (id, userId = 'user-a', extra = {}) => ({ id, metadata: { hasPendingWrites: false }, data: () => ({ id, userId, createdAt: 1, ...extra }) })
const snapshot = (docs = [], fromCache = false) => ({ docs, metadata: { fromCache } })
const context = { projectId: 'demo-memorizador-solar', collection: 'cards', queryName: 'activeCards' }

test('cada consulta filtrada y ordenada tiene su índice COLLECTION y el desempate por nombre correcto', async () => {
  const config = JSON.parse(await readFile(new URL('../../firebase.json', import.meta.url), 'utf8'))
  assert.equal(config.firestore.rules, 'firestore.rules')
  const manifest = JSON.parse(await readFile(new URL(`../../${config.firestore.indexes}`, import.meta.url), 'utf8'))
  const expected = requiredPrivateIndexes()
  assert.equal(expected.length, 5)
  for (const spec of expected) {
    assert.ok(manifest.indexes.some((index) => index.collectionGroup === spec.collectionGroup && index.queryScope === spec.queryScope &&
      JSON.stringify(index.fields.filter((field) => field.fieldPath !== '__name__')) === JSON.stringify(spec.fields) &&
      (!index.fields.some((field) => field.fieldPath === '__name__') || index.fields.at(-1).order === 'ASCENDING')), `Falta índice: ${JSON.stringify(spec)}`)
  }
  assert.deepEqual(manifest.fieldOverrides, [], 'Las consultas también necesitan los índices de campo único predeterminados.')
})

test('conserva los códigos originales y diferencia índices, permisos, sesión, conexión y cuota', () => {
  for (const code of ['failed-precondition', 'permission-denied', 'unauthenticated', 'unavailable', 'resource-exhausted']) {
    const originalMessage = code === 'failed-precondition' ? 'The query requires an index.' : 'SDK original message'
    const state = failedReadState({ code: `firestore/${code}`, message: originalMessage }, context)
    assert.equal(state.status, 'error')
    assert.equal(state.diagnostic.code, code)
    assert.equal(state.diagnostic.originalMessage, originalMessage)
    assert.equal(state.loading, false)
    assert.ok(state.error)
    assert.notEqual(state.status, 'ready', 'Un fallo no representa una colección vacía.')
  }
  assert.match(failedReadState({ code: 'failed-precondition', message: 'The query requires an index.' }, context).error, /índice/)
  assert.doesNotMatch(failedReadState({ code: 'failed-precondition', message: 'The database is disabled.' }, context).error, /necesita un índice/)
  assert.equal(failedReadState(null, context).diagnostic.code, 'unknown')
})

test('solo una respuesta válida del servidor puede confirmar cero resultados', () => {
  assert.equal(emptyReadState().status, 'idle')
  assert.equal(loadingReadState().status, 'loading')
  assert.equal(snapshotReadState(snapshot(), 'user-a', schema, contract).status, 'ready')
  assert.equal(snapshotReadState(snapshot([], true), 'user-a', schema, contract).status, 'unconfirmed')
  assert.equal(snapshotReadState(snapshot([entry('a')], true), 'user-a', schema, contract).status, 'unconfirmed')
  assert.equal(snapshotReadState(snapshot([entry('a', 'user-b')]), 'user-a', schema, contract).status, 'invalid')
  assert.equal(snapshotReadState(snapshot([entry('a', 'user-a', { id: 'another-id' })]), 'user-a', schema, contract).status, 'invalid')
  const pending = { ...entry('a', 'user-a', { createdAt: null }), metadata: { hasPendingWrites: true } }
  assert.equal(snapshotReadState(snapshot([pending]), 'user-a', schema, contract).status, 'unconfirmed')
  const pendingUpdate = { ...entry('a'), metadata: { hasPendingWrites: true } }
  assert.equal(snapshotReadState(snapshot([pendingUpdate]), 'user-a', schema, contract).status, 'unconfirmed')
  const queryPending = { ...snapshot([entry('a')]), metadata: { fromCache: false, hasPendingWrites: true } }
  assert.equal(snapshotReadState(queryPending, 'user-a', schema, contract).status, 'unconfirmed')
})

test('una página con datos corruptos permanece incompleta; no descarta ni reescribe documentos', () => {
  const docs = [entry('ok'), entry('broken', 'user-a', { createdAt: 'invalid' })]
  const result = snapshotReadState(snapshot(docs), 'user-a', schema, contract)
  assert.equal(result.status, 'invalid')
  assert.deepEqual(result.items.map((item) => item.id), ['ok'])
  assert.match(result.error, /incompleto/)
  assert.equal(docs[1].data().createdAt, 'invalid')
})

test('paginación conserva 40 documentos, cursor del último visible y señal de página siguiente', () => {
  const docs = Array.from({ length: 41 }, (_, index) => entry(`a-${index}`))
  const result = snapshotReadState(snapshot(docs), 'user-a', schema, contract)
  assert.equal(result.status, 'ready')
  assert.equal(result.items.length, 40)
  assert.equal(result.last, docs[39])
  assert.equal(result.hasMore, true)
})

test('listener: error explícito, reintento con resultado vacío auténtico y cancelación de callbacks antiguos', () => {
  const subscriptions = []; const states = []
  const subscribe = (_ref, options, success, failure) => {
    assert.equal(options.includeMetadataChanges, true)
    const record = { success, failure, stopped: false }; subscriptions.push(record)
    return () => { record.stopped = true }
  }
  const config = { subscribe, uid: 'user-a', schema, contract, context, onState: (state) => states.push(state) }
  const stop = subscribePrivateRead({}, config)
  subscriptions[0].failure({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
  assert.equal(states.at(-1).status, 'error')
  stop()
  assert.equal(subscriptions[0].stopped, true)
  const retry = subscribePrivateRead({}, config)
  subscriptions[1].success(snapshot())
  assert.equal(states.at(-1).status, 'ready')
  assert.deepEqual(states.at(-1).items, [])
  subscriptions[0].success(snapshot([entry('stale')]))
  subscriptions[0].failure({ code: 'unavailable' })
  assert.equal(states.length, 2)
  subscriptions[1].success(snapshot([entry('live')]))
  assert.equal(states.at(-1).items[0].id, 'live')
  retry()
})
