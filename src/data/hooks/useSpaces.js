import { useEffect, useState } from 'react'
import { collection, documentId, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { SPACE_TYPES, spaceContract } from '../firestore/spacesRepository.js'

export const SPACE_PAGE_SIZE = 40
const empty = { items: [], loading: false, error: '', hasMore: false, last: null }

export function useSpaces(userId, kind, parentId = null) {
  const scope = `${userId}:${kind}:${parentId ?? ''}`
  const [pager, setPager] = useState({ scope, after: null, previous: [] })
  const [state, setState] = useState({ ...empty, scope: '', loading: true })
  const [retry, setRetry] = useState(0)
  const page = pager.scope === scope ? pager : { scope, after: null, previous: [] }
  const after = page.after

  useEffect(() => {
    if (!db || !userId || (kind !== 'palace' && !parentId)) return undefined
    const type = SPACE_TYPES[kind]
    const constraints = []
    if (kind !== 'palace') constraints.push(where(kind === 'macro' ? 'palaceId' : 'macroId', '==', parentId))
    constraints.push(orderBy(kind === 'palace' ? 'createdAt' : 'ordinal'), orderBy(documentId()))
    if (after) constraints.push(startAfter(after))
    constraints.push(limit(SPACE_PAGE_SIZE + 1))
    setState({ ...empty, scope, loading: true })
    return onSnapshot(query(collection(db, 'users', userId, type.collection), ...constraints), (snapshot) => {
      const documents = snapshot.docs.slice(0, SPACE_PAGE_SIZE)
      const items = []
      let invalid = false
      for (const entry of documents) {
        // A local serverTimestamp is null until the transaction is acknowledged.
        if (entry.metadata.hasPendingWrites && !entry.data()?.createdAt) continue
        const parsed = type.schema.safeParse(spaceContract(entry.data()))
        if (parsed.success && parsed.data.id === entry.id && parsed.data.userId === userId) items.push(parsed.data)
        else invalid = true
      }
      setState({ scope, items, loading: false, error: invalid ? 'Hay estaciones con datos no válidos. Se han omitido; no se modificó su contenido.' : '', hasMore: snapshot.docs.length > SPACE_PAGE_SIZE, last: documents.at(-1) ?? null })
    }, () => setState({ ...empty, scope, error: 'No se pudieron leer las estaciones. Comprueba la conexión y las reglas e índices de Firestore.' }))
  }, [userId, kind, parentId, scope, after, retry])

  const enabled = Boolean(db && userId && (kind === 'palace' || parentId))
  const current = !enabled ? empty : state.scope === scope ? state : { ...empty, loading: true }
  return {
    ...current,
    pageNumber: page.previous.length + 1,
    canGoBack: page.previous.length > 0,
    nextPage() {
      if (current.hasMore && current.last && !current.loading) setPager({ scope, after: current.last, previous: [...page.previous, after] })
    },
    previousPage() {
      if (page.previous.length && !current.loading) setPager({ scope, after: page.previous.at(-1), previous: page.previous.slice(0, -1) })
    },
    retry() { setRetry((value) => value + 1) },
  }
}
