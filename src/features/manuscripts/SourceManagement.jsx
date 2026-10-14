import { EVOLUTION_ENABLED } from '../../evolution.js'
import { useEffect, useRef, useState } from 'react'
import { setSourceArchived } from '../../data/firestore/sourceLifecycleRepository.js'
import { db } from '../../firebase.js'
import { useLiteralData } from '../../data/hooks/useLiteralData.js'
import ContextHelp from '../guidance/ContextHelp.jsx'

async function administrativeRequest(user, body) {
  const token = await user.getIdToken()
  const response = await fetch('/api/manuscripts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let result
  try { result = await response.json() } catch { throw new Error('El servicio de eliminación no está disponible. La biblioteca y el archivado no necesitan ese servicio.') }
  if (!response.ok) throw new Error(result.error || `No se completó la operación (${response.status}).`)
  return result
}
function Management({ user, source, onChanged }) {
  const [busy, setBusy] = useState(false); const gate = useRef(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null); const [confirmation, setConfirmation] = useState(''); const [job, setJob] = useState(null); const [page, setPage] = useState(0)
  const intent = useRef(crypto.randomUUID()); const jobs = useLiteralData(user.uid, 'deletionJobs', 'sourceId', source.id)
  const pending = job || jobs.items.find((item) => !['completed', 'cancelled'].includes(item.state))
  const [clock, setClock] = useState(Date.now())
  const leaseSeconds = pending?.lease?.until?.seconds ?? 0
  useEffect(() => { if (!leaseSeconds) return undefined; const timer = setInterval(() => setClock(Date.now()), 2000); return () => clearInterval(timer) }, [leaseSeconds])
  const leaseActive = leaseSeconds * 1000 > clock
  async function action(callback) {
    if (gate.current) return
    gate.current = true; setBusy(true); setError(''); setNotice('')
    try { await callback() } catch (failure) { setError(failure.message) } finally { gate.current = false; setBusy(false) }
  }
  async function resume(initial) {
    let current = initial
    setJob(current)
    // Each HTTP call handles one bounded checkpoint; refreshing the page can resume the same job.
    while (!['completed', 'cancelled'].includes(current.state)) {
      current = await administrativeRequest(user, { action: 'step', jobId: current.id }); setJob(current)
    }
    if (current.state === 'completed') { setNotice('El manuscrito y sus dependencias se eliminaron. Los loci conservan su identidad y descansan.'); onChanged?.('deleted') }
  }
  return <section className="source-management" aria-label={`Gestión de ${source.title}`}><ContextHelp topic="sources.lifecycle" />{error && <p className="notice notice-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<div className="actions"><button type="button" className="button button-secondary" disabled={busy || Boolean(pending)} onClick={() => action(async () => { await setSourceArchived(db, user.uid, source.id, source.lifecycle !== 'archived', crypto.randomUUID()); setNotice(source.lifecycle === 'archived' ? 'Restaurado sin modificar el progreso ni las fechas de repaso.' : 'Archivado: se conservan el progreso y las asociaciones; queda excluido del estudio.'); onChanged?.() })}>{source.lifecycle === 'archived' ? 'Restaurar manuscrito' : 'Archivar manuscrito'}</button>{source.lifecycle === 'archived' && <button type="button" className="button button-danger" disabled={busy || Boolean(pending)} onClick={() => action(async () => { setPreview(await administrativeRequest(user, { action: 'preview', sourceId: source.id })); setConfirmation(''); setPage(0); intent.current = crypto.randomUUID() })}>Eliminar definitivamente</button>}</div>
    {preview && !pending && <div className="card deletion-confirmation"><h3>Revisar eliminación definitiva</h3><ContextHelp topic="sources.deletion" /><p>Se eliminarán {preview.totalDocuments} documentos. {preview.loci} loci pasarán a descanso. Esta operación es irreversible. Conserva una copia propia antes de continuar.</p><ul>{Object.entries(preview.counts).map(([kind, count]) => <li key={kind}>{kind}: {count}</li>)}</ul><details><summary>Documentos afectados ({preview.documents.length})</summary><ul>{preview.documents.slice(page * 40, page * 40 + 40).map((doc, i) => <li key={i}>{doc.kind} / {doc.id}</li>)}</ul><div className="actions"><button type="button" className="button button-secondary" disabled={!page} onClick={() => setPage((p) => p - 1)}>Anteriores</button><button type="button" className="button button-secondary" disabled={(page + 1) * 40 >= preview.documents.length} onClick={() => setPage((p) => p + 1)}>Siguientes</button></div></details>{preview.blockers.length > 0 && <div role="alert"><p>Otros manuscritos dependen de este contenido. El borrado está bloqueado, incluidos los manuscritos archivados.</p><ul>{preview.blockers.map((blocker, i) => <li key={i}>{blocker.sourceTitle || blocker.sourceId || blocker.id} · {blocker.kind} · {blocker.reason}</li>)}</ul></div>}<label>Para confirmar, escribe el título exacto: {source.title}<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><div className="actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancelar sin borrar</button><button type="button" className="button button-danger" disabled={busy || confirmation !== source.title || preview.blockers.length > 0} onClick={() => action(async () => { const operation = await administrativeRequest(user, { action: 'start', sourceId: source.id, fingerprint: preview.fingerprint, requestId: intent.current }); await resume(operation) })}>Confirmar eliminación irreversible</button></div></div>}
    {pending && <div className="notice"><p role="status">Eliminación {pending.state}: {pending.completed || 0} / {pending.total || 0} operaciones confirmadas.</p><progress max={pending.total || 1} value={pending.completed || 0} aria-label="Progreso de eliminación" /><p>Si se interrumpe, vuelve a esta ficha y reanuda. Tras el primer lote no es posible deshacer.</p><div className="actions"><button type="button" className="button" disabled={busy} onClick={() => action(() => resume(pending))}>Reanudar eliminación</button><button type="button" className="button button-secondary" disabled={busy || pending.cursor !== 0 || leaseActive} onClick={() => action(async () => { await administrativeRequest(user, { action: 'cancel', jobId: pending.id }); setJob(null); setPreview(null) })}>Cancelar antes del primer lote</button></div></div>}
  </section>
}

export default function SourceManagement(props) { return EVOLUTION_ENABLED ? <Management {...props} /> : null }
