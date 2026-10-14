import { EVOLUTION_ENABLED } from '../../evolution.js'
import { useEffect, useState } from 'react'
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { privateRef } from '../../data/firestore/cognitiveRepository.js'

function GuardBody({ uid, unitIds, sourceId, onBack, children }) {
  const key = JSON.stringify([uid, sourceId, unitIds])
  const [state, setState] = useState({ key: null, error: '', ready: false, seenReady: false, pending: false })
  useEffect(() => {
    let active = true; const unsubscribe = []; const statuses = new Map()
    function update(next) { if (active) setState((previous) => ({ ...next, key, seenReady: next.ready || previous.key === key && previous.seenReady })) }
    const fail = (error) => update({ ready: false, pending: false, error: error?.message || 'No se pudo comprobar la disponibilidad.' })
    async function watch() {
      const ids = sourceId ? [sourceId] : await Promise.all([...new Set(unitIds || [])].map(async (id) => {
        const unit = await getDocFromServer(privateRef(db, uid, 'units', id))
        if (!unit.exists() || unit.data().userId !== uid) throw new Error('La unidad ya no está disponible.')
        return unit.data().sourceId
      }))
      if (!active) return
      const refs = [...new Set(ids)].map((id) => privateRef(db, uid, 'sources', id))
      refs.push(doc(db, 'users', uid, 'control', 'maintenance'))
      refs.forEach((ref, i) => unsubscribe.push(onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
        if (!active) return
        const prior = statuses.get(i)
        const error = i === refs.length - 1 ? snapshot.exists() && snapshot.data().blocked ? 'El archivo está en mantenimiento. Reanuda la eliminación pendiente.' : '' : !snapshot.exists() || snapshot.data().userId !== uid || snapshot.data().lifecycle !== 'active' ? 'El manuscrito fue archivado o eliminado. La sesión se ha detenido sin alterar su agenda.' : ''
        const pending = snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites
        statuses.set(i, { active: !error && (!pending || prior?.active === true), pending, error })
        const values = [...statuses.values()]
        update({ ready: statuses.size === refs.length && values.every((v) => v.active), pending: values.some((v) => v.pending), error: values.find((v) => v.error)?.error || '' })
      }, (failure) => { statuses.set(i, { active: false, pending: false, error: failure.message }); fail(failure) })))
    }
    watch().catch(fail)
    return () => { active = false; unsubscribe.forEach((stop) => stop()) }
    // The serialized key includes all identifiers and prevents subscription churn on rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const current = state.key === key ? state : { ready: false, seenReady: false, pending: false, error: '' }
  return <div className="study-availability">
    {current.pending && current.ready && <p className="notice" role="status">Sin confirmación reciente de conexión. Tu intento se conserva; guardar requiere conexión y comprobar otra vez que el manuscrito esté activo.</p>}
    {!current.ready && <section className="card"><p role={current.error ? 'alert' : 'status'}>{current.error || 'Comprobando disponibilidad del manuscrito…'}</p><button type="button" className="button button-secondary" onClick={onBack}>Volver al archivo</button></section>}
    {/* Keep an existing attempt mounted during a connection interruption or an archival pause. */}
    <div hidden={!current.ready}>{current.seenReady ? children : null}</div>
  </div>
}
export default function ActiveStudyGuard(props) { return EVOLUTION_ENABLED ? <GuardBody {...props} /> : props.children }
