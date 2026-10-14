import { useEffect, useState } from 'react'
import { getDocFromServer, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { privateRef } from '../firestore/cognitiveRepository.js'

export function useAvailableCards(uid, cards) {
  const key = JSON.stringify([uid, cards.items.map((card) => [card.id, card.unitId, card.sourceId, card.version])])
  const [state, setState] = useState({ key: null, allowed: [], error: '' })
  useEffect(() => {
    if (!uid || cards.status !== 'ready') return undefined
    let active = true; const stops = []; const sourceStates = new Map()
    async function load() {
      const pairs = await Promise.all([...new Set(cards.items.map((card) => card.unitId || card.sourceId))].map(async (id) => {
        if (cards.items.some((card) => card.sourceId === id && !card.unitId)) return [id, id]
        const snapshot = await getDocFromServer(privateRef(db, uid, 'units', id))
        if (!snapshot.exists() || snapshot.data().userId !== uid) throw new Error('Una tarjeta referencia una unidad no disponible.')
        return [id, snapshot.data().sourceId]
      }))
      const sources = [...new Set(pairs.map((pair) => pair[1]))]
      if (!active) return
      if (!sources.length) setState({ key, allowed: [], error: '' })
      for (const id of sources) stops.push(onSnapshot(privateRef(db, uid, 'sources', id), { includeMetadataChanges: true }, (snapshot) => {
        if (!active) return
        if (!snapshot.exists()) { setState({ key, allowed: [], error: 'No se encontró la fuente de una tarjeta. No se puede calcular la cola.' }); return }
        sourceStates.set(id, { confirmed: !snapshot.metadata.fromCache, active: snapshot.data().lifecycle === 'active' })
        if (sourceStates.size === sources.length && [...sourceStates.values()].every((v) => v.confirmed)) setState({ key, error: '', allowed: pairs.filter((pair) => sourceStates.get(pair[1]).active).map((pair) => pair[0]) })
      }, (error) => { if (active) setState({ key, allowed: [], error: `${error.code || 'read-error'}: ${error.message}` }) }))
    }
    load().catch((error) => { if (active) setState({ key, allowed: [], error: error.message }) })
    return () => { active = false; stops.forEach((stop) => stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cards.status, uid])
  if (cards.status !== 'ready') return cards
  if (state.key !== key) return { ...cards, status: 'loading', loading: true, items: [] }
  if (state.error) return { ...cards, status: 'error', loading: false, error: state.error, items: [] }
  return { ...cards, items: cards.items.filter((card) => state.allowed.includes(card.unitId || card.sourceId)) }
}
