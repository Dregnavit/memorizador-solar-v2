import ContextHelp from '../guidance/ContextHelp.jsx'
import { useEffect, useRef, useState } from 'react'
import { doc, getDocFromServer } from 'firebase/firestore'
import { proposeSegments } from '@icarus/domain/segmentation'
import { sourceRevisionSchema } from '@icarus/domain/schemas'
import { db } from '../../firebase.js'
import { useLearningData } from '../../data/hooks/useLearningData.js'
import { createSource, createUnit, newPrivateId, privateRef, recordContract } from '../../data/firestore/cognitiveRepository.js'
import EncodingWorkshop, { LearningPager } from './EncodingWorkshop.jsx'
import SteppedReview from './SteppedReview.jsx'
import { learningError, TARGET_LABELS } from './messages.js'
import ReadNotice from '../../components/ReadNotice.jsx'

const dueMillis = (card) => card.dueAt.seconds * 1000 + card.dueAt.nanoseconds / 1000000
function SourceForm({ user, onClose, onCreated }) {
  const dialog = useRef(null)
  const intent = useRef(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState('prose')
  const [mode, setMode] = useState('sentences')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function save(event) {
    event.preventDefault()
    if (busy.current) return
    if (!title.trim() || !text.trim()) { setError('Escribe un título y un manuscrito con contenido.'); return }
    const input = { title: title.trim(), originalText: text, kind, segmentationMode: mode }
    const key = JSON.stringify(input)
    if (intent.current?.key !== key) intent.current = { key, id: newPrivateId(db, user.uid, 'sources') }
    busy.current = true; setSaving(true); setError('')
    try { const id = await createSource(db, user.uid, input, intent.current.id); onCreated(id) }
    catch (failure) { setError(learningError(failure)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <dialog ref={dialog} className="modal card" aria-labelledby="source-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose() }}><h2 id="source-form-title">Nuevo manuscrito Ícaro</h2><form onSubmit={save}><fieldset disabled={saving}><legend className="sr-only">Fuente original</legend><div className="field"><label htmlFor="source-title">Título del manuscrito</label><input id="source-title" aria-describedby="guide-source-title" autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /><ContextHelp topic="sources.title" descriptionId="guide-source-title" /></div><div className="field"><label htmlFor="source-kind">Género del manuscrito</label><select id="source-kind" aria-describedby="guide-source-kind" value={kind} onChange={(event) => { setKind(event.target.value); setMode(event.target.value === 'poetry' ? 'stanzas' : 'sentences') }}><option value="prose">Prosa</option><option value="poetry">Poesía</option></select><ContextHelp topic="sources.kind" descriptionId="guide-source-kind" /></div><div className="field"><label htmlFor="source-segmentation">Propuesta inicial de unidades</label><select id="source-segmentation" aria-describedby="guide-source-segmentation" value={mode} onChange={(event) => setMode(event.target.value)}><option value="sentences">Oraciones</option><option value="verses">Versos</option><option value="stanzas">Estrofas</option></select><ContextHelp topic="sources.segmentation" descriptionId="guide-source-segmentation" /></div><div className="field"><label htmlFor="source-text">Manuscrito original íntegro</label><textarea id="source-text" aria-describedby="guide-source-text" required maxLength={60000} value={text} onChange={(event) => setText(event.target.value)} /><ContextHelp topic="sources.text" descriptionId="guide-source-text" /><p className="field-help">Los cortes son propuestas. Puedes seleccionar una unidad distinta sin reescribir el original.</p></div>{error && <p className="notice notice-error" role="alert">{error}</p>}<div className="actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button" type="submit">{saving ? 'Guardando…' : 'Guardar manuscrito'}</button></div></fieldset></form></dialog>
}
function UnitCards({ uid, unit, onStudy }) {
  const cards = useLearningData(uid, 'cards', 'unitId', unit.id, 'target')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const due = cards.items.filter((card) => dueMillis(card) <= now)
  return <div><ContextHelp topic="sources.queue" /><ReadNotice data={cards} />{cards.status === 'ready' ? <><ul className="learning-card-list">{cards.items.map((card) => <li key={card.id}><strong>{TARGET_LABELS[card.target]}</strong><span className={`badge ${dueMillis(card) <= now ? 'badge-due' : 'badge-done'}`}>{dueMillis(card) <= now ? 'Pendiente' : 'Programado'}</span><span>Próximo repaso: {new Date(dueMillis(card)).toLocaleString('es')}</span></li>)}</ul><div className="actions"><button className="button" type="button" disabled={!due.length} onClick={() => onStudy(due)}>Repasar objetivos pendientes ({due.length})</button><button className="button button-secondary" type="button" disabled={!cards.items.length} onClick={() => onStudy(cards.items)}>Practicar todos los objetivos</button></div></> : <p>Los objetivos de esta unidad todavía no están disponibles para repasar.</p>}</div>
}
function SourceReader({ user, sourceId, onBack, onWorkshop, onStudy }) {
  const [state, setState] = useState({ revision: null, title: '', error: '' })
  const [selection, setSelection] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const units = useLearningData(user.uid, 'units', 'sourceId', sourceId, 'ordinal')
  useEffect(() => {
    let active = true
    async function load() {
      const ref = privateRef(db, user.uid, 'sources', sourceId)
      const source = await getDocFromServer(ref)
      if (!source.exists()) throw new Error('Este manuscrito ya no está disponible.')
      const revision = await getDocFromServer(doc(ref, 'revisions', source.data().currentRevisionId))
      if (!revision.exists()) throw new Error('No se encontró la revisión original.')
      const parsed = sourceRevisionSchema.parse(recordContract(revision.data()))
      if (parsed.userId !== user.uid || parsed.sourceId !== sourceId) throw new Error('Referencia de fuente incoherente.')
      if (active) setState({ revision: parsed, title: source.data().title, error: '' })
    }
    load().catch((failure) => { if (active) setState({ revision: null, title: '', error: learningError(failure) }) })
    return () => { active = false }
  }, [user.uid, sourceId])
  async function prepare(segment) {
    if (busyRef.current || !state.revision) return
    busyRef.current = true; setBusy(true); setError('')
    try { const unitId = await createUnit(db, user.uid, sourceId, { revisionId: state.revision.id, startOffset: segment.startOffset, endOffset: segment.endOffset, ordinal: segment.startOffset }); onWorkshop(unitId) }
    catch (failure) { setError(learningError(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const proposals = state.revision ? proposeSegments(state.revision.originalText, ['sentences', 'verses', 'stanzas'].includes(state.revision.segmentationMode) ? state.revision.segmentationMode : 'sentences') : []
  const [proposalPage, setProposalPage] = useState(0)
  return <section><button className="button button-quiet back-button" type="button" onClick={onBack} disabled={busy}>← Volver al archivo Ícaro</button><h2>{state.title || 'Leyendo manuscrito…'}</h2>{(state.error || error) && <p className="notice notice-error" role="alert">{state.error || error}</p>}{state.revision && <>
    <div className="card"><div className="field"><label htmlFor="source-selection">Selecciona una unidad en el manuscrito original</label><textarea id="source-selection" aria-describedby="guide-source-selection" className="source-selection" readOnly value={state.revision.originalText} onSelect={(event) => setSelection(event.target.selectionEnd > event.target.selectionStart ? { startOffset: event.target.selectionStart, endOffset: event.target.selectionEnd } : null)} /><ContextHelp topic="sources.selection" descriptionId="guide-source-selection" /></div><button className="button button-secondary" type="button" disabled={busy || !selection} onClick={() => prepare(selection)}>Preparar selección del manuscrito</button></div>
    <div className="card"><h3>Unidades propuestas para revisar</h3><p>Elige un corte coherente o selecciona otro en el manuscrito. Nada se convierte en una tarjeta sin completar el Taller.</p><ol className="proposal-list" start={proposalPage * 20 + 1}>{proposals.slice(proposalPage * 20, proposalPage * 20 + 20).map((segment) => <li key={`${segment.startOffset}-${segment.endOffset}`}><p>{segment.text}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => prepare(segment)}>Preparar unidad {segment.ordinal + 1}</button></li>)}</ol>{proposals.length > 20 && <div className="actions"><button className="button button-secondary" type="button" disabled={proposalPage === 0} onClick={() => setProposalPage((value) => value - 1)}>Propuestas anteriores</button><button className="button button-secondary" type="button" disabled={(proposalPage + 1) * 20 >= proposals.length} onClick={() => setProposalPage((value) => value + 1)}>Más propuestas</button></div>}</div>
    <h3>Unidades de tu recorrido</h3><ReadNotice data={units} />{units.items.map((unit) => <article className="card learning-unit" key={unit.id}><blockquote>{unit.text}</blockquote>{unit.status === 'ready' ? <><p className="badge badge-done">Taller aprobado · Codificación activa</p><UnitCards uid={user.uid} unit={unit} onStudy={onStudy} /></> : <button className="button" type="button" onClick={() => onWorkshop(unit.id)}>Continuar Taller de esta unidad</button>}</article>)}<LearningPager data={units} />
  </>}</section>
}

export default function CognitiveLibrary({ user, onBack, onBuildSpaces, onSessionChange }) {
  const [sourceId, setSourceId] = useState(null)
  const [unitId, setUnitId] = useState(null)
  const [queue, setQueue] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const browsingUid = queue || unitId ? null : user.uid
  const sources = useLearningData(browsingUid, 'sources')
  const cards = useLearningData(browsingUid, 'cards', 'lifecycle', 'active', 'dueAt')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => { onSessionChange?.(Boolean(queue || unitId)); return () => onSessionChange?.(false) }, [queue, unitId, onSessionChange])
  const due = cards.items.filter((card) => dueMillis(card) <= now)
  if (queue) return <SteppedReview user={user} queue={queue} onFinish={(completed) => { setQueue(null); setNotice(completed ? 'Sesión completada. Cada objetivo conserva su propia agenda.' : 'Sesión terminada. Se conservaron los repasos confirmados.') }} />
  if (unitId) return <EncodingWorkshop user={user} unitId={unitId} onBack={() => setUnitId(null)} onPublished={() => { setUnitId(null); setNotice('Codificación publicada. El locus y las tarjetas quedaron vinculados.') }} onBuildSpaces={onBuildSpaces} />
  if (sourceId) return <>{notice && <p className="notice notice-success" role="status">{notice}</p>}<SourceReader key={sourceId} user={user} sourceId={sourceId} onBack={() => setSourceId(null)} onWorkshop={(id) => { setUnitId(id); setNotice('') }} onStudy={(items) => { setQueue(items); setNotice('') }} /></>
  return <section aria-labelledby="icarus-library-title"><button className="button button-quiet back-button" type="button" onClick={onBack}>← Volver al modo clásico</button><div className="page-heading"><div><p className="eyebrow">Comprender · Imaginar · Recuperar</p><h2 id="icarus-library-title">Archivo del Método Ícaro</h2><p>Construye significado y una escena en un lugar estable antes de entrar al repaso.</p></div><button className="button" type="button" onClick={() => setFormOpen(true)}>+ Nuevo manuscrito Ícaro</button></div><ContextHelp topic="sources.overview" />{notice && <p className="notice notice-success" role="status">{notice}</p>}<div className="card" aria-label="Repasos escalonados"><h3>Repasos escalonados</h3><ContextHelp topic="sources.queue" /><ReadNotice data={cards} />{cards.status === 'ready' ? <><p>{due.length} objetivos pendientes en esta página de hasta 40 tarjetas.</p><button className="button" type="button" disabled={!due.length} onClick={() => setQueue(due)}>Iniciar repaso escalonado ({due.length})</button></> : <p>No se ha podido determinar cuántos objetivos están pendientes.</p>}<LearningPager data={cards} /></div><ReadNotice data={sources} /><div className="text-grid">{sources.items.map((source) => <article className="card" key={source.id}><p className="eyebrow">{source.kind === 'poetry' ? 'Poesía' : 'Prosa'} · Fuente versionada</p><h3>{source.title}</h3><button className="button" type="button" onClick={() => { setSourceId(source.id); setNotice('') }} aria-label={`Abrir manuscrito ${source.title}`}>Leer y codificar</button></article>)}</div>{sources.status === 'ready' && !sources.items.length && <div className="card"><h3>Tu archivo Ícaro comienza aquí</h3><p>Los textos clásicos siguen disponibles. Este archivo conserva nuevas fuentes íntegras y codificaciones explícitas; todavía no aplica migraciones automáticas.</p><button className="button button-secondary" type="button" onClick={onBuildSpaces}>Construir mis palacios</button></div>}<LearningPager data={sources} />{formOpen && <SourceForm user={user} onClose={() => setFormOpen(false)} onCreated={(id) => { setFormOpen(false); setSourceId(id) }} />}</section>
}
