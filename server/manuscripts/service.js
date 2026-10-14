import { idSchema } from '@icarus/domain/schemas'
import { validateInventoryDocument, validateRevision } from './contracts.js'
import { createHash, randomUUID } from 'node:crypto'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'

const MAX_DOCUMENTS = 20000
const kinds = ['sources', 'units', 'encodingDrafts', 'concepts', 'conceptEdges', 'encodings', 'cards', 'reviewEvents', 'reviewAttempts', 'studySessions', 'spaceEvents', 'legacyLinks', 'legacyProgress', 'literalPrograms', 'literalExercises', 'literalCards', 'literalAttempts', 'literalBindings', 'literalHints', 'literalMemberships', 'sourceEvents', 'sourceOperations']
const allowed = new Set([...kinds, 'palaces', 'macroStations', 'microStations', 'migrationJobs', 'settings', 'control', 'deletionJobs'])
const checkId = (id) => { if (!idSchema.safeParse(id).success || Buffer.byteLength(id, 'utf8') > 1500) throw fault('Identificador no válido.', 400); return id }
const fault = (message, status = 409) => Object.assign(new Error(message), { status })
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const stamp = (doc) => doc.updateTime ? `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}` : 'missing'
async function documents(ref) {
  const result = []; let cursor
  do {
    let q = ref.orderBy(FieldPath.documentId()).limit(200)
    if (cursor) q = q.startAfter(cursor)
    const page = await q.get(); result.push(...page.docs); cursor = page.size === 200 ? page.docs.at(-1) : null
    if (result.length > MAX_DOCUMENTS) throw fault('El inventario supera el límite operativo. No se ha eliminado información.', 413)
  } while (cursor)
  return result
}
async function descendants(ref, output) {
  for (const sub of await ref.listCollections()) for (const child of await sub.listDocuments()) {
    const snapshot = await child.get()
    if (snapshot.exists && !validateRevision(child.path, snapshot.data())) throw fault('Se encontró una revisión con un contrato desconocido. No se borró ningún documento.')
    await descendants(child, output); output.push({ path: child.path, stamp: stamp(snapshot) })
    if (output.length > MAX_DOCUMENTS) throw fault('Demasiados documentos para esta operación.', 413)
  }
}
export async function inventory(db, uid, sourceId) {
  checkId(sourceId)
  const root = db.collection('users').doc(uid)
  for (const ref of await root.listCollections()) if (!allowed.has(ref.id)) throw fault(`Colección no reconocida: ${ref.id}. El borrado requiere revisar su relación con el manuscrito.`)
  const source = await root.collection('sources').doc(sourceId).get()
  if (!source.exists || source.data().userId !== uid) throw fault('No se encontró el manuscrito de esta cuenta.', 404)
  if (source.data().lifecycle !== 'archived') throw fault('Archiva el manuscrito antes de eliminarlo.')
  const graph = new Map()
  let count = 0
  for (const kind of kinds) {
    const entries = await documents(root.collection(kind)); count += entries.length
    if (count > MAX_DOCUMENTS) throw fault('La cuenta supera el límite del inventario seguro.', 413)
    for (const entry of entries) {
      if (entry.data().userId !== uid) throw fault('Se encontró un documento con propietario incoherente.')
      if (!validateInventoryDocument(kind, entry)) throw fault(`Documento incompatible en ${kind}/${entry.id}. Revisa su contrato antes de eliminar.`)
    }
    if (['sources', 'units', 'concepts', 'encodings'].includes(kind)) {
      const ids = new Set(entries.map((doc) => doc.id))
      const roots = await root.collection(kind).listDocuments()
      if (roots.some((ref) => !ids.has(ref.id))) throw fault(`Hay subcolecciones con padre ausente en ${kind}. Revisa su integridad antes de borrar.`)
    }
    graph.set(kind, entries)
  }
  const primaryConcepts = new Set(); const selected = new Set([source.ref.path]); const selectedIds = new Map(kinds.map((kind) => [kind, new Set()])); selectedIds.get('sources').add(sourceId); const ids = (kind) => selectedIds.get(kind)
  for (let pass = 0; pass < 8; pass++) for (const [kind, entries] of graph) for (const doc of entries) {
    const d = doc.data()
    if (kind === 'sources') continue
    if (kind === 'concepts' && primaryConcepts.has(doc.id) || kind === 'conceptEdges' && !d.encodingId && ids('concepts').has(d.fromConceptId) || d.sourceId === sourceId || ids('units').has(d.unitId) || ids('encodings').has(d.encodingId) || ids('cards').has(d.cardId) || ids('literalCards').has(d.cardId) || ids('literalPrograms').has(d.programId) || ids('literalExercises').has(d.exerciseId)) { selected.add(doc.ref.path); selectedIds.get(kind).add(doc.id); if (kind === 'units' && d.primaryConceptId) primaryConcepts.add(d.primaryConceptId) }
  }
  const concepts = ids('concepts'); const units = ids('units'); const encodings = ids('encodings'); const bindings = ids('literalBindings')
  const byId = (kind) => new Map(graph.get(kind).map((item) => [item.id, item.data()]))
  const unitData = byId('units'); const encodingData = byId('encodings'); const conceptData = byId('concepts'); const sourceData = byId('sources')
  const sourceFor = (d) => {
    if (d.sourceId) return d.sourceId
    const encodingId = d.encodingId || conceptData.get(d.fromConceptId)?.encodingId
    const unitId = d.unitId || encodingData.get(encodingId)?.unitId
    return unitData.get(unitId)?.sourceId || null
  }
  const blockers = []
  for (const [kind, entries] of graph) for (const snapshot of entries) {
    if (selected.has(snapshot.ref.path)) continue
    const d = snapshot.data()
    if (concepts.has(d.fromConceptId) || concepts.has(d.toConceptId) || concepts.has(d.primaryConceptId) || concepts.has(d.conceptId) || concepts.has(d.qualityGate?.linkedConceptId) || ids('conceptEdges').has(d.edgeId) || encodings.has(d.activeEncodingId) || encodings.has(d.encodingId) || (Array.isArray(d.evidenceUnitIds) && d.evidenceUnitIds.some((id) => units.has(id))) || (Array.isArray(d.unitIds) && d.unitIds.some((id) => units.has(id)))) blockers.push({ kind, id: snapshot.id, sourceId: sourceFor(d), sourceTitle: sourceData.get(sourceFor(d))?.title || null, reason: 'Conserva una referencia al manuscrito.' })
  }
  const spaces = await documents(root.collection('microStations'))
  if (spaces.some((snapshot) => snapshot.data().userId !== uid || !validateInventoryDocument('microStations', snapshot))) throw fault('Se encontró un locus con propietario incoherente.')
  const loci = spaces.filter((locus) => encodings.has(locus.data().activeEncodingId) || bindings.has(locus.data().activeBinding?.id)).map((locus) => ({ path: locus.ref.path, encodingId: locus.data().activeEncodingId || null, bindingId: locus.data().activeBinding?.id || null, version: locus.data().version }))
  for (const entry of graph.get('encodings').filter((doc) => selected.has(doc.ref.path))) if (!loci.some((locus) => locus.encodingId === entry.id)) throw fault('Una codificación carece de su ocupación espacial. Revisa la integridad antes de borrar.')
  const items = []; const counts = {}
  for (const [kind, entries] of graph) for (const entry of entries) if (selected.has(entry.ref.path)) {
    await descendants(entry.ref, items); items.push({ path: entry.ref.path, stamp: stamp(entry) }); counts[kind] = (counts[kind] || 0) + 1
  }
  items.sort((a, b) => b.path.split('/').length - a.path.split('/').length || (a.path === source.ref.path ? 1 : b.path === source.ref.path ? -1 : a.path.localeCompare(b.path)))
  if (items.length > MAX_DOCUMENTS) throw fault('El grafo supera el límite operativo.', 413)
  // Fingerprint all graph roots: unrelated changes may require a fresh preview, but cannot hide new references.
  const hash = fingerprint({ docs: [...graph.values()].flat().map((d) => [d.ref.path, stamp(d)]).sort(), items, loci, blockers })
  return { sourceId, title: source.data().title, counts, totalDocuments: items.length, loci: loci.length, blockers, fingerprint: hash, items, releases: loci }
}
const publicInventory = (data) => { const { items, releases: _releases, ...summary } = data; return ({ ...summary, documents: items.map((item) => ({ kind: item.path.split('/')[2], id: item.path.split('/').slice(3).join('/') })) }) }
export async function preview(db, uid, sourceId) { return publicInventory(await inventory(db, uid, sourceId)) }
export async function startDeletion(db, uid, sourceId, expectedFingerprint, requestId) {
  checkId(requestId); checkId(sourceId)
  if (typeof expectedFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw fault('Inventario no válido.', 400)
  const root = db.collection('users').doc(uid); const lock = root.collection('control').doc('maintenance'); const jobRef = root.collection('deletionJobs').doc(requestId); const worker = randomUUID()
  let previous
  await db.runTransaction(async (tx) => {
    const [barrier, existing] = await Promise.all([tx.get(lock), tx.get(jobRef)])
    previous = existing.exists ? existing.data() : null
    if (previous && (previous.sourceId !== sourceId || previous.fingerprint !== expectedFingerprint)) throw fault('La operación corresponde a otro inventario.')
    if (previous && previous.state !== 'preparing') return
    if (barrier.data()?.blocked && barrier.data().jobId !== requestId) throw fault('Reanuda la eliminación que ya está en curso.')
    if (previous?.lease && previous.lease.until.toMillis() > Date.now()) throw fault('El inventario está siendo preparado. Reintenta en unos segundos.')
    tx.set(lock, { blocked: true, jobId: requestId, userId: uid, createdAt: FieldValue.serverTimestamp() })
    tx.set(jobRef, { id: requestId, userId: uid, sourceId, fingerprint: expectedFingerprint, state: 'preparing', cursor: 0, totalPages: 0, completed: 0, total: 0, lease: { id: worker, until: Timestamp.fromMillis(Date.now() + 45000) }, error: '', version: 1 })
  })
  if (previous && previous.state !== 'preparing') return { id: requestId, ...previous }
  try {
    const data = await inventory(db, uid, sourceId)
    if (data.blockers.length) throw fault('Otros manuscritos dependen de este contenido. El borrado está bloqueado.')
    if (data.fingerprint !== expectedFingerprint) throw fault('El archivo cambió. Solicita y confirma un inventario nuevo.')
    const tasks = [...data.releases.map((locus) => ({ type: 'release', ...locus })), ...data.items.map((item) => ({ type: 'delete', ...item }))]
    const pages = []
    for (let i = 0; i < tasks.length; i += 40) pages.push(tasks.slice(i, i + 40))
    for (let offset = 0; offset < pages.length; offset += 20) await db.runTransaction(async (tx) => {
      const current = await tx.get(jobRef)
      if (current.data()?.lease?.id !== worker || current.data().state !== 'preparing') throw fault('La preparación cambió de trabajador o fue cancelada.')
      pages.slice(offset, offset + 20).forEach((tasks, index) => tx.set(jobRef.collection('pages').doc(String(offset + index)), { tasks }))
      tx.update(jobRef, { lease: { id: worker, until: Timestamp.fromMillis(Date.now() + 45000) } })
    })
    await db.runTransaction(async (tx) => {
      const current = await tx.get(jobRef)
      if (current.data()?.lease?.id !== worker || current.data().state !== 'preparing') throw fault('Otro trabajador tomó la preparación.')
      tx.update(jobRef, { state: 'ready', totalPages: pages.length, total: tasks.length, lease: null })
    })
    return { id: requestId, ...(await jobRef.get()).data() }
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const [job, barrier] = await Promise.all([tx.get(jobRef), tx.get(lock)])
      if (job.data()?.lease?.id !== worker || job.data().state !== 'preparing') return
      // No destructive checkpoint can run while preparing. Cancellation here is safe.
      tx.update(jobRef, { state: 'cancelled', lease: null, error: error.message })
      if (barrier.data()?.jobId === requestId) tx.set(lock, { blocked: false, jobId: null, userId: uid })
    })
    throw error
  }
}
async function finalizeDeletion(db, uid, jobId) {
  const root = db.collection('users').doc(uid); const ref = root.collection('deletionJobs').doc(jobId); const lock = root.collection('control').doc('maintenance')
  const data = (await ref.get()).data()
  if (data.state === 'completed') return { id: jobId, ...data }
  if (data.cursor !== data.totalPages || data.state === 'preparing') throw fault('El manifiesto no está completo.')
  const pages = await documents(ref.collection('pages'))
  if (data.completed !== data.total) throw fault('El número de operaciones confirmadas no coincide con el manifiesto.')
  // Each checkpoint atomically deletes its tasks and advances completed; the barrier prevents any client from recreating them.
  const source = root.collection('sources').doc(data.sourceId)
  if ((await source.get()).exists || (await source.listCollections()).length) throw fault('Quedan datos o subcolecciones bajo la fuente.')
  await db.runTransaction(async (tx) => {
    const [job, barrier] = await Promise.all([tx.get(ref), tx.get(lock)])
    if (job.data().state === 'completed') return
    if (job.data().cursor !== job.data().totalPages || barrier.data()?.jobId !== jobId) throw fault('El cierre de la operación cambió.')
    tx.update(ref, { state: 'completed', lease: null }); tx.set(lock, { blocked: false, jobId: null, userId: uid })
  })
  for (let i = 0; i < pages.length; i += 400) { const batch = db.batch(); pages.slice(i, i + 400).forEach((page) => batch.delete(page.ref)); await batch.commit() }
  return { id: jobId, ...(await ref.get()).data() }
}
export async function stepDeletion(db, uid, jobId) {
  checkId(jobId)
  const root = db.collection('users').doc(uid); const ref = root.collection('deletionJobs').doc(jobId); const lock = root.collection('control').doc('maintenance'); const worker = randomUUID()
  const initial = await ref.get()
  if (!initial.exists || initial.data().userId !== uid) throw fault('No se encontró el trabajo de esta cuenta.', 404)
  if (initial.data().state === 'preparing') return startDeletion(db, uid, initial.data().sourceId, initial.data().fingerprint, jobId)
  if (initial.data().state === 'cancelled') return { id: jobId, ...initial.data() }
  if (initial.data().cursor === initial.data().totalPages && initial.data().state !== 'completed') return finalizeDeletion(db, uid, jobId)
  let claimed
  await db.runTransaction(async (tx) => {
    const [job, barrier] = await Promise.all([tx.get(ref), tx.get(lock)])
    if (!job.exists || job.data().userId !== uid) throw fault('No se encontró el trabajo de esta cuenta.', 404)
    claimed = job.data()
    if (claimed.state === 'completed') return
    if (!barrier.data()?.blocked || barrier.data().jobId !== jobId) throw fault('La barrera de mantenimiento no coincide.')
    if (claimed.lease && claimed.lease.until.toMillis() > Date.now()) throw fault('Otro trabajador está procesando este lote. Reintenta en unos segundos.')
    tx.update(ref, { lease: { id: worker, until: Timestamp.fromMillis(Date.now() + 45000) }, state: 'running', error: '' })
  })
  if (claimed.state === 'completed') return { id: jobId, ...claimed }
  try {
    const page = await ref.collection('pages').doc(String(claimed.cursor)).get()
    if (!page.exists) throw fault('No se encontró el manifiesto de este checkpoint.')
    await db.runTransaction(async (tx) => {
      const job = await tx.get(ref)
      if (job.data().state !== 'running' || job.data().lease?.id !== worker || job.data().cursor !== claimed.cursor) throw fault('El checkpoint cambió de trabajador.')
      const tasks = page.data().tasks
      const reads = await Promise.all(tasks.map((task) => tx.get(db.doc(task.path))))
      tasks.forEach((task, i) => {
        const snapshot = reads[i]
        if (task.type === 'release') {
          if (!snapshot.exists || snapshot.data().version !== task.version || (snapshot.data().activeEncodingId || null) !== task.encodingId || (snapshot.data().activeBinding?.id || null) !== task.bindingId) throw fault('La ocupación del locus cambió. No se liberó un anclaje ajeno.')
          tx.set(snapshot.ref.collection('revisions').doc(`v${task.version}`), snapshot.data())
          tx.update(snapshot.ref, { version: task.version + 1, state: 'cooling', activeEncodingId: null, ...(snapshot.data().schemaVersion === 2 ? { activeBinding: null } : {}) })
        } else {
          if (snapshot.exists && stamp(snapshot) !== task.stamp) throw fault('Un documento cambió después de confirmar el inventario.')
          tx.delete(db.doc(task.path))
        }
      })
      tx.update(ref, { cursor: claimed.cursor + 1, completed: claimed.completed + tasks.length, lease: null, state: 'ready', version: job.data().version + 1 })
    })
    const updated = (await ref.get()).data()
    if (updated.cursor === updated.totalPages) return finalizeDeletion(db, uid, jobId)
    return { id: jobId, ...(await ref.get()).data() }
  } catch (error) {
    await db.runTransaction(async (tx) => { const job = await tx.get(ref); if (job.data()?.lease?.id === worker) tx.update(ref, { lease: null, state: 'error', error: error.message }) })
    throw error
  }
}
export async function cancelDeletion(db, uid, jobId) {
  checkId(jobId); const root = db.collection('users').doc(uid); const ref = root.collection('deletionJobs').doc(jobId)
  await db.runTransaction(async (tx) => {
    const job = await tx.get(ref); const lock = root.collection('control').doc('maintenance'); const barrier = await tx.get(lock)
    if (!job.exists || job.data().userId !== uid || job.data().cursor !== 0 || job.data().lease && job.data().lease.until.toMillis() > Date.now()) throw fault('Después del primer lote solo es posible reanudar hasta completar.')
    if (barrier.data()?.jobId !== jobId) throw fault('La barrera pertenece a otra operación.')
    tx.update(ref, { state: 'cancelled', lease: null }); tx.set(lock, { blocked: false, jobId: null, userId: uid })
  })
  const pages = await documents(ref.collection('pages'))
  for (let i = 0; i < pages.length; i += 400) { const batch = db.batch(); pages.slice(i, i + 400).forEach((page) => batch.delete(page.ref)); await batch.commit() }
  return { id: jobId, state: 'cancelled' }
}
