import { originalOffsetFromTextarea } from '@icarus/domain/literal'
import { EVOLUTION_ENABLED } from '../../evolution.js'
import SourceManagement from '../manuscripts/SourceManagement.jsx'
import ActiveStudyGuard from '../manuscripts/ActiveStudyGuard.jsx'
import LiteralWorkspace, { LiteralProgram } from '../literal/LiteralWorkspace.jsx'
import { useAvailableCards } from '../../data/hooks/useAvailableCards.js'
import { useLiteralData } from '../../data/hooks/useLiteralData.js'
import ContextHelp from '../guidance/ContextHelp.jsx'
import { useEffect, useRef, useState } from 'react'
import { doc, getDocFromServer, onSnapshot } from 'firebase/firestore'
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
  const [learningGoal, setLearningGoal] = useState('conceptual')
  const [language, setLanguage] = useState('und')
  const [edition, setEdition] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function save(event) {
    event.preventDefault()
    if (busy.current) return
    if (text.length > 60000) { setError('El manuscrito supera 60.000 caracteres. No se ha truncado ni guardado: divídelo explícitamente antes de continuar.'); return }
    if (!title.trim() || !text.trim()) { setError('Escribe un título y un manuscrito con contenido.'); return }
    const input = { title: title.trim(), originalText: text, kind, segmentationMode: mode, ...(EVOLUTION_ENABLED ? { learningGoal, language, edition } : {}) }
    const key = JSON.stringify(input)
    if (intent.current?.key !== key) intent.current = { key, id: newPrivateId(db, user.uid, 'sources') }
    busy.current = true; setSaving(true); setError('')
    try { const id = await createSource(db, user.uid, input, intent.current.id); onCreated(id) }
    catch (failure) { setError(learningError(failure)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <dialog ref={dialog} className="modal card" aria-labelledby="source-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose() }}><h2 id="source-form-title">Nuevo manuscrito</h2><form onSubmit={save}><fieldset disabled={saving}><legend className="sr-only">Fuente original</legend>{EVOLUTION_ENABLED && <><ContextHelp topic="literal.goals" /><label>Objetivo de aprendizaje<select aria-label="Objetivo de aprendizaje" value={learningGoal} onChange={(event) => setLearningGoal(event.target.value)}><option value="conceptual">Aprendizaje Conceptual</option><option value="literal">Memorización Literal</option><option value="combined">Aprendizaje Combinado</option></select></label><label>Idioma (etiqueta BCP 47; und si no lo conoces)<input maxLength={100} value={language} onChange={(event) => setLanguage(event.target.value)} /></label><label>Edición o versión textual<input maxLength={500} value={edition} onChange={(event) => setEdition(event.target.value)} /></label><ContextHelp topic="literal.edition" /></>}<div className="field"><label htmlFor="source-title">Título del manuscrito</label><input id="source-title" aria-describedby="guide-source-title" autoFocus required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /><ContextHelp topic="sources.title" descriptionId="guide-source-title" /></div><div className="field"><label htmlFor="source-kind">Género del manuscrito</label><select id="source-kind" aria-describedby="guide-source-kind" value={kind} onChange={(event) => { setKind(event.target.value); setMode(event.target.value === 'poetry' ? 'stanzas' : 'sentences') }}><option value="prose">Prosa</option><option value="poetry">Poesía</option></select><ContextHelp topic="sources.kind" descriptionId="guide-source-kind" /></div><div className="field"><label htmlFor="source-segmentation">Propuesta inicial de unidades</label><select id="source-segmentation" aria-describedby="guide-source-segmentation" value={mode} onChange={(event) => setMode(event.target.value)}><option value="sentences">Oraciones</option><option value="verses">Versos</option><option value="stanzas">Estrofas</option></select><ContextHelp topic="sources.segmentation" descriptionId="guide-source-segmentation" /></div><div className="field"><label htmlFor="source-text">Manuscrito original íntegro</label><textarea id="source-text" aria-describedby="guide-source-text" required value={text} onChange={(event) => setText(event.target.value)} /><ContextHelp topic="sources.text" descriptionId="guide-source-text" /><p className="field-help">{text.length.toLocaleString('es')} / 60.000 caracteres. Los cortes son propuestas. Puedes seleccionar una unidad distinta sin reescribir el original.</p></div>{error && <p className="notice notice-error" role="alert">{error}</p>}<div className="actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button" type="submit">{saving ? 'Guardando…' : 'Guardar manuscrito'}</button></div></fieldset></form></dialog>
}
function UnitCards({ uid, unit, onStudy }) {
  const cards = useLearningData(uid, 'cards', 'unitId', unit.id, 'target')
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const due = cards.items.filter((card) => dueMillis(card) <= now)
  return <div><ContextHelp topic="sources.queue" /><ReadNotice data={cards} />{cards.status === 'ready' ? <><ul className="learning-card-list">{cards.items.map((card) => <li key={card.id}><strong>{TARGET_LABELS[card.target]}</strong><span className={`badge ${dueMillis(card) <= now ? 'badge-due' : 'badge-done'}`}>{dueMillis(card) <= now ? 'Pendiente' : 'Programado'}</span><span>Próximo repaso: {new Date(dueMillis(card)).toLocaleString('es')}</span></li>)}</ul><div className="actions"><button className="button" type="button" disabled={!due.length} onClick={() => onStudy(due)}>Repasar objetivos pendientes ({due.length})</button><button className="button button-secondary" type="button" disabled={!cards.items.length} onClick={() => onStudy(cards.items)}>Practicar todos los objetivos</button></div></> : <p>Los objetivos de esta unidad todavía no están disponibles para repasar.</p>}</div>
}
function SourceReader({ user, sourceId, onBack, onWorkshop, onStudy, onLiteralProgram, onDeleted }) {
  const [state, setState] = useState({ revision: null, source: null, title: '', error: '' })
  const [selection, setSelection] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const units = useLearningData(user.uid, 'units', 'sourceId', sourceId, 'ordinal')
  useEffect(() => {
    let active = true
    async function load(source) {
      const ref = privateRef(db, user.uid, 'sources', sourceId)
      if (!source.exists()) throw new Error('Este manuscrito ya no está disponible.')
      const revision = await getDocFromServer(doc(ref, 'revisions', source.data().currentRevisionId))
      if (!revision.exists()) throw new Error('No se encontró la revisión original.')
      const parsed = sourceRevisionSchema.parse(recordContract(revision.data()))
      if (parsed.userId !== user.uid || parsed.sourceId !== sourceId) throw new Error('Referencia de fuente incoherente.')
      if (active) setState({ revision: parsed, source: source.data(), title: source.data().title, error: '' })
    }
    const stop = onSnapshot(privateRef(db, user.uid, 'sources', sourceId), (snapshot) => load(snapshot).catch((failure) => { if (active) setState({ revision: null, source: null, title: '', error: learningError(failure) }) }), (failure) => { if (active) setState({ revision: null, source: null, title: '', error: learningError(failure) }) })
    return () => { active = false; stop() }
  }, [user.uid, sourceId])
  async function prepare(segment) {
    if (busyRef.current || !state.revision || state.source?.lifecycle !== 'active') return
    busyRef.current = true; setBusy(true); setError('')
    try { const unitId = await createUnit(db, user.uid, sourceId, { revisionId: state.revision.id, startOffset: segment.startOffset, endOffset: segment.endOffset, ordinal: segment.startOffset }); onWorkshop(unitId) }
    catch (failure) { setError(learningError(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const proposals = state.revision ? proposeSegments(state.revision.originalText, ['sentences', 'verses', 'stanzas'].includes(state.revision.segmentationMode) ? state.revision.segmentationMode : 'sentences') : []
  const [proposalPage, setProposalPage] = useState(0)
  return <section><button className="button button-quiet back-button" type="button" onClick={onBack} disabled={busy}>← Volver al archivo de manuscritos</button><h2>{state.title || 'Leyendo manuscrito…'}</h2>{(state.error || error) && <p className="notice notice-error" role="alert">{state.error || error}</p>}{state.source && <SourceManagement user={user} source={state.source} onChanged={(type) => { if (type === 'deleted') onDeleted() }} />}{state.source?.lifecycle === 'archived' && <p className="notice">Manuscrito archivado. Restaura para reanudar el aprendizaje; sus agendas siguen intactas.</p>}{state.revision && state.source?.lifecycle === 'active' && <>
    {EVOLUTION_ENABLED && <LiteralWorkspace user={user} sourceId={sourceId} revision={state.revision} onWorkshop={onWorkshop} onOpenProgram={onLiteralProgram} />}
    <div className="card"><div className="field"><label htmlFor="source-selection">Selecciona una unidad en el manuscrito original</label><textarea id="source-selection" aria-describedby="guide-source-selection" className="source-selection" readOnly value={state.revision.originalText} onSelect={(event) => setSelection(event.target.selectionEnd > event.target.selectionStart ? { startOffset: originalOffsetFromTextarea(state.revision.originalText, event.target.selectionStart), endOffset: originalOffsetFromTextarea(state.revision.originalText, event.target.selectionEnd) } : null)} /><ContextHelp topic="sources.selection" descriptionId="guide-source-selection" /></div><button className="button button-secondary" type="button" disabled={busy || !selection} onClick={() => prepare(selection)}>Preparar selección del manuscrito</button></div>
    <div className="card"><h3>Unidades propuestas para revisar</h3><p>Elige un corte coherente o selecciona otro en el manuscrito. Las tarjetas conceptuales requieren el Taller. La memorización literal usa su preparación independiente.</p><ol className="proposal-list" start={proposalPage * 20 + 1}>{proposals.slice(proposalPage * 20, proposalPage * 20 + 20).map((segment) => <li key={`${segment.startOffset}-${segment.endOffset}`}><p>{segment.text}</p><button className="button button-secondary" type="button" disabled={busy} onClick={() => prepare(segment)}>Preparar unidad {segment.ordinal + 1}</button></li>)}</ol>{proposals.length > 20 && <div className="actions"><button className="button button-secondary" type="button" disabled={proposalPage === 0} onClick={() => setProposalPage((value) => value - 1)}>Propuestas anteriores</button><button className="button button-secondary" type="button" disabled={(proposalPage + 1) * 20 >= proposals.length} onClick={() => setProposalPage((value) => value + 1)}>Más propuestas</button></div>}</div>
    <h3>Unidades de tu recorrido</h3><ReadNotice data={units} />{units.items.map((unit) => <article className="card learning-unit" key={unit.id}><blockquote>{unit.text}</blockquote>{unit.status === 'ready' ? <><p className="badge badge-done">Taller aprobado · Codificación activa</p><UnitCards uid={user.uid} unit={unit} onStudy={onStudy} /></> : <button className="button" type="button" onClick={() => onWorkshop(unit.id)}>Continuar Taller de esta unidad</button>}</article>)}<LearningPager data={units} />
  </>}</section>
}

export default function CognitiveLibrary({ user, onBack, onBuildSpaces, onSessionChange }) {
  const [sourceId, setSourceId] = useState(null)
  const [archived, setArchived] = useState(false)
  const [literalSession, setLiteralSession] = useState(null)
  const [unitId, setUnitId] = useState(null)
  const [queue, setQueue] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const browsingUid = queue || unitId || literalSession ? null : user.uid
  const sources = useLearningData(browsingUid, 'sources')
  const rawCards = useLearningData(browsingUid, 'cards', 'lifecycle', 'active', 'dueAt')
  const cards = useAvailableCards(browsingUid, rawCards)
  const literalRaw = useLiteralData(EVOLUTION_ENABLED ? browsingUid : null, 'literalCards', null, undefined)
  const literalCards = useAvailableCards(browsingUid, literalRaw)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  useEffect(() => { onSessionChange?.(Boolean(queue || unitId || literalSession)); return () => onSessionChange?.(false) }, [queue, unitId, literalSession, onSessionChange])
  const due = cards.items.filter((card) => dueMillis(card) <= now)
  const literalDue = literalCards.items.filter((card) => dueMillis(card) <= now)
  if (literalSession) return <LiteralProgram user={user} programId={literalSession.programId} initialExercise={literalSession.scope ? literalSession : undefined} onWorkshop={(id) => { setLiteralSession(null); setUnitId(id) }} onBack={() => setLiteralSession(null)} />
  if (queue) return <ActiveStudyGuard uid={user.uid} unitIds={queue.map((card) => card.unitId)} onBack={() => setQueue(null)}><SteppedReview user={user} queue={queue} onFinish={(completed) => { setQueue(null); setNotice(completed ? 'Sesión completada. Cada objetivo conserva su propia agenda.' : 'Sesión terminada. Se conservaron los repasos confirmados.') }} /></ActiveStudyGuard>
  if (unitId) return <ActiveStudyGuard uid={user.uid} unitIds={[unitId]} onBack={() => setUnitId(null)}><EncodingWorkshop user={user} unitId={unitId} onBack={() => setUnitId(null)} onPublished={() => { setUnitId(null); setNotice('Codificación publicada. El locus y las tarjetas quedaron vinculados.') }} onBuildSpaces={onBuildSpaces} /></ActiveStudyGuard>
  if (sourceId) return <>{notice && <p className="notice notice-success" role="status">{notice}</p>}<SourceReader key={sourceId} user={user} sourceId={sourceId} onDeleted={() => { setSourceId(null); setNotice('Manuscrito eliminado definitivamente. Se conservaron los demás manuscritos y el historial espacial. Los loci liberados descansan.') }} onLiteralProgram={(programId) => setLiteralSession({ programId })} onBack={() => setSourceId(null)} onWorkshop={(id) => { setUnitId(id); setNotice('') }} onStudy={(items) => { setQueue(items); setNotice('') }} /></>
  return <section aria-labelledby="icarus-library-title"><button className="button button-quiet back-button" type="button" onClick={onBack}>← Volver al modo clásico</button><div className="page-heading"><div><p className="eyebrow">Comprender · Imaginar · Recuperar</p><h2 id="icarus-library-title">Mis manuscritos</h2><p>Construye significado y una escena en un lugar estable antes de entrar al repaso.</p></div><button className="button" type="button" onClick={() => setFormOpen(true)}>+ Nuevo manuscrito</button></div><ContextHelp topic="sources.overview" />{notice && <p className="notice notice-success" role="status">{notice}</p>}<div className="card" aria-label="Repasos escalonados"><h3>Repasos escalonados</h3><ContextHelp topic="sources.queue" /><ReadNotice data={cards} />{cards.status === 'ready' ? <><p>{due.length} objetivos pendientes en esta página de hasta 40 tarjetas.</p><button className="button" type="button" disabled={!due.length} onClick={() => setQueue(due)}>Iniciar repaso escalonado ({due.length})</button></> : <p>No se ha podido determinar cuántos objetivos están pendientes.</p>}<LearningPager data={cards} /></div>{EVOLUTION_ENABLED && <div className="card"><h3>Repasos de Memorización Literal</h3><ContextHelp topic="literal.exams" />{literalCards.error && <p role="alert">{literalCards.error}</p>}{literalCards.status === 'ready' ? <><p>{literalDue.length} ejercicios pendientes.</p><ul>{literalDue.slice(0, 40).map((card) => <li key={card.id}><button type="button" className="button button-secondary" onClick={() => setLiteralSession({ programId: card.programId, start: card.start, end: card.end, scope: card.scope })}>Repasar {card.scope} · segmentos {card.start + 1}–{card.end}</button></li>)}</ul></> : <p role="status">Comprobando agendas literales; aún no se pueden determinar los pendientes.</p>}</div>}<div className="actions"><button type="button" className="button button-secondary" aria-pressed={!archived} onClick={() => setArchived(false)}>Activos</button><button type="button" className="button button-secondary" aria-pressed={archived} onClick={() => setArchived(true)}>Archivados</button></div><ContextHelp topic="sources.lifecycle" /><ReadNotice data={sources} /><div className="text-grid">{sources.items.filter((source) => (source.lifecycle === 'archived') === archived).map((source) => <article className="card" key={source.id}><p className="eyebrow">{source.kind === 'poetry' ? 'Poesía' : 'Prosa'} · Fuente versionada</p><h3>{source.title}</h3><button className="button" type="button" onClick={() => { setSourceId(source.id); setNotice('') }} aria-label={`Abrir manuscrito ${source.title}`}>Leer y estudiar</button><SourceManagement user={user} source={source} onChanged={(type) => { if (type === 'deleted') setNotice('Manuscrito eliminado definitivamente.') }} /></article>)}</div>{sources.status === 'ready' && !sources.items.filter((source) => (source.lifecycle === 'archived') === archived).length && <div className="card"><h3>{archived ? 'No hay archivados en esta página' : sources.items.length || sources.canGoBack ? 'Sin manuscritos activos en esta página' : 'Tu biblioteca comienza aquí'}</h3><p>Los textos clásicos siguen disponibles. Este archivo conserva nuevas fuentes íntegras y codificaciones explícitas; todavía no aplica migraciones automáticas.</p><button className="button button-secondary" type="button" onClick={onBuildSpaces}>Construir mis palacios</button></div>}<LearningPager data={sources} />{formOpen && <SourceForm user={user} onClose={() => setFormOpen(false)} onCreated={(id) => { setFormOpen(false); setSourceId(id) }} />}</section>
}
