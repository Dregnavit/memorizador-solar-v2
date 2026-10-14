import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { recordContract } from '../firestore/cognitiveRepository.js'
import { literalProgramSchema, literalCardSchema, literalBindingSchema, literalAttemptSchema, literalExerciseSchema } from '@icarus/domain/literal'

export function useLiteralData(uid, kind, field, value) {
  const key = JSON.stringify([uid, kind, field, value])
  const [state, setState] = useState({ key: null, items: [], status: 'loading', error: '' })
  useEffect(() => {
    if (!uid || value === null) return undefined
    const ref = collection(db, 'users', uid, kind); const target = field ? query(ref, where(field, '==', value)) : ref
    return onSnapshot(target, { includeMetadataChanges: true }, (snapshot) => {
      try {
        const schema = kind === 'literalPrograms' ? literalProgramSchema : kind === 'literalCards' ? literalCardSchema : kind === 'literalBindings' ? literalBindingSchema : kind === 'literalAttempts' ? literalAttemptSchema : kind === 'literalExercises' ? literalExerciseSchema : null
        const items = snapshot.docs.map((doc) => { const raw = recordContract(doc.data()); const item = schema ? schema.parse(raw) : raw; if (item.userId !== uid || item.id !== doc.id) throw new Error('Propietario o identificador incoherente.'); return item })
        setState({ key, items, status: snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites ? 'unconfirmed' : 'ready', error: '' })
      } catch { setState({ key, items: [], status: 'error', error: 'La colección literal contiene documentos incompatibles. No se modificó su contenido.' }) }
    }, (error) => setState({ key, items: [], status: 'error', error: `${error.code}: ${error.message}` }))
  }, [uid, kind, field, value, key])
  return state.key === key ? state : { items: [], status: 'loading', error: '' }
}
