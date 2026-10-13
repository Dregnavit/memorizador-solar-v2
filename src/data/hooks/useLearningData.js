import { useEffect, useState } from 'react'
import { collection, documentId, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore'
import { sourceSchema, unitSchema, conceptSchema, cardSchema } from '@icarus/domain/schemas'
import { db } from '../../firebase.js'
import { recordContract } from '../firestore/cognitiveRepository.js'

const schemas = { sources: sourceSchema, units: unitSchema, concepts: conceptSchema, cards: cardSchema }
const EMPTY = { items: [], loading: false, error: '', hasMore: false, last: null }
export function useLearningData(uid, kind, field = null, value = null, sort = 'createdAt') {
  const key = `${uid}:${kind}:${field}:${value}:${sort}`
  const [pager, setPager] = useState({ key, cursor: null, prior: [] })
  const [state, setState] = useState({ ...EMPTY, key: '' })
  const [retry, setRetry] = useState(0)
  const page = pager.key === key ? pager : { key, cursor: null, prior: [] }
  const cursor = page.cursor
  const enabled = Boolean(db && uid && (!field || value !== null))
  useEffect(() => {
    if (!enabled) return undefined
    const constraints = field ? [where(field, '==', value)] : []
    constraints.push(orderBy(sort), orderBy(documentId()))
    if (cursor) constraints.push(startAfter(cursor))
    constraints.push(limit(41))
    setState({ ...EMPTY, key, loading: true })
    return onSnapshot(query(collection(db, 'users', uid, kind), ...constraints), (snapshot) => {
      const entries = snapshot.docs.slice(0, 40)
      const items = []; let invalid = false
      for (const entry of entries) {
        if (entry.metadata.hasPendingWrites && !entry.data()?.createdAt) continue
        const data = schemas[kind].safeParse(recordContract(entry.data()))
        if (data.success && data.data.id === entry.id && data.data.userId === uid) items.push(data.data)
        else invalid = true
      }
      setState({ key, items, loading: false, error: invalid ? 'Se omitieron documentos no válidos, sin modificar su contenido.' : '', hasMore: snapshot.docs.length > 40, last: entries.at(-1) ?? null })
    }, () => setState({ ...EMPTY, key, error: 'No se pudieron leer los datos. Revisa la conexión, las reglas y los índices.' }))
  }, [uid, kind, field, value, sort, key, cursor, enabled, retry])
  const current = !enabled ? EMPTY : state.key === key ? state : { ...EMPTY, loading: true }
  return { ...current, page: page.prior.length + 1, canGoBack: page.prior.length > 0,
    next() { if (current.hasMore && current.last && !current.loading) setPager({ key, cursor: current.last, prior: [...page.prior, cursor] }) },
    back() { if (page.prior.length && !current.loading) setPager({ key, cursor: page.prior.at(-1), prior: page.prior.slice(0, -1) }) },
    retry() { setRetry((count) => count + 1) },
  }
}
