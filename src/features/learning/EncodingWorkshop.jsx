import { useRef, useState } from 'react'
import { WORKSHOP_STEPS, workshopIssues } from '@icarus/domain/encoding'
import { db } from '../../firebase.js'
import { useWorkshopDraft } from '../../data/hooks/useWorkshopDraft.js'
import { useSpaces } from '../../data/hooks/useSpaces.js'
import { useLearningData } from '../../data/hooks/useLearningData.js'
import { publishEncoding } from '../../data/firestore/cognitiveRepository.js'
import { learningError } from './messages.js'
import ReadNotice from '../../components/ReadNotice.jsx'
import ContextHelp, { GuidedStep } from '../guidance/ContextHelp.jsx'

function TextField({ label, name, value, onChange, help, rows = 3 }) {
  return <div className="field"><label htmlFor={`workshop-${name}`}>{label}</label><textarea id={`workshop-${name}`} maxLength={4000} rows={rows} value={value ?? ''} onChange={(event) => onChange(name, event.target.value)} aria-describedby={`${help ? `help-${name} ` : ''}guidance-${name}`} />{help && <p className="field-help" id={`help-${name}`}>{help}</p>}<ContextHelp topic={`workshop.${name}`} descriptionId={`guidance-${name}`} /></div>
}
function Check({ label, name, value, onChange }) { return <div className="guided-check-field"><label className="learning-check"><input type="checkbox" checked={value === true} aria-describedby={`guidance-${name}`} onChange={(event) => onChange(name, event.target.checked)} /> {label}</label><ContextHelp topic={`workshop.${name}`} context={{ [name]: value }} descriptionId={`guidance-${name}`} /></div> }
export function LearningPager({ data }) {
  return data.hasMore || data.canGoBack ? <div className="actions"><button className="button button-secondary" type="button" disabled={!data.canGoBack || data.loading} onClick={data.back ?? data.previousPage}>Anterior</button><span>Página {data.page ?? data.pageNumber}</span><button className="button button-secondary" type="button" disabled={!data.hasMore || data.status !== 'ready'} onClick={data.next ?? data.nextPage}>Siguiente</button></div> : null
}
function SpacePicker({ uid, p, update, onBuild }) {
  const palaces = useSpaces(uid, 'palace')
  const macros = useSpaces(uid, 'macro', p.palaceId)
  const loci = useSpaces(uid, 'locus', p.macroId)
  const options = [{ data: palaces, key: 'palaceId', label: 'Palacio para la escena', items: palaces.items.filter((entry) => entry.lifecycle === 'active') }, { data: macros, key: 'macroId', label: 'Macro-estación para la escena', items: macros.items.filter((entry) => entry.lifecycle === 'active') }, { data: loci, key: 'locusId', label: 'Locus libre', items: loci.items }]
  function select(key, value) {
    update(key, value || null)
    if (key === 'palaceId') { update('macroId', null); update('locusId', null) }
    if (key === 'macroId') update('locusId', null)
  }
  const selectedLocus = loci.items.find((item) => item.id === p.locusId)
  const unavailable = selectedLocus && (selectedLocus.state !== 'free' || selectedLocus.activeEncodingId)
  const states = { occupied: 'ocupado', reserved: 'reservado', cooling: 'en descanso', archived: 'archivado' }
  return <div>{options.map(({ data, key, label, items }) => <div className="field" key={key}><label htmlFor={key}>{label}</label><select id={key} aria-describedby={`guidance-${key}`} disabled={data.status !== 'ready'} value={p[key] ?? ''} onChange={(event) => select(key, event.target.value)}><option value="">Selecciona un lugar</option>{items.map((entry) => { const blocked = key === 'locusId' && (entry.state !== 'free' || entry.activeEncodingId); return <option key={entry.id} value={entry.id} disabled={Boolean(blocked)}>{entry.title ?? entry.name}{blocked ? ` (${states[entry.state] ?? 'no disponible'})` : ''}</option> })}</select><ContextHelp topic={`workshop.${key}`} descriptionId={`guidance-${key}`} /><ReadNotice data={data} /><LearningPager data={data} /></div>)}{unavailable && <p className="notice notice-error" role="alert">Este locus ya no está libre. Su codificación actual debe conservarse; elige otro lugar. Tu borrador no se ha sustituido.</p>}<button type="button" className="button button-secondary" onClick={onBuild}>Guardar borrador y construir lugares</button><p className="field-help">Un locus aloja una sola codificación activa. Su disponibilidad se comprueba de nuevo al publicar.</p></div>
}
function EntranceExam({ p, unit, update, onRework }) {
  const [scene, setScene] = useState('')
  const [meaning, setMeaning] = useState('')
  const [structure, setStructure] = useState('')
  const [revealed, setRevealed] = useState(false)
  return <div className="entrance-exam">
    <p>Imagina el locus elegido y responde sin consultar la fuente ni tu escena escrita.</p>
    {!revealed ? <>
      <div className="field"><label htmlFor="entrance-scene">¿Qué sucede en tu escena?</label><textarea id="entrance-scene" aria-describedby="guidance-entrance-scene" maxLength={4000} value={scene} onChange={(event) => setScene(event.target.value)} /><ContextHelp topic="entrance.scene" descriptionId="guidance-entrance-scene" /></div>
      <div className="field"><label htmlFor="entrance-meaning">¿Qué significa, con tus palabras?</label><textarea id="entrance-meaning" aria-describedby="guidance-entrance-meaning" maxLength={4000} value={meaning} onChange={(event) => setMeaning(event.target.value)} /><ContextHelp topic="entrance.meaning" descriptionId="guidance-entrance-meaning" /></div>
      <div className="field"><label htmlFor="entrance-structure">Justifica una relación, inferencia o ejemplo</label><textarea id="entrance-structure" aria-describedby="guidance-entrance-structure" maxLength={4000} value={structure} onChange={(event) => setStructure(event.target.value)} /><ContextHelp topic="entrance.structure" descriptionId="guidance-entrance-structure" /></div>
      <div className="actions"><button className="button" type="button" disabled={![scene, meaning, structure].every((answer) => answer.trim())} onClick={() => { update('entranceAttempted', true); setRevealed(true) }}>Comprobar mi recuerdo</button><button className="button button-secondary" type="button" onClick={onRework}>No lo recuperé: volver a la imagen</button></div>
    </> : <>
      <div className="learning-comparison"><article><h4>Tu recuperación</h4><p>{scene}</p><p>{meaning}</p><p>{structure}</p></article><article><h4>Codificación que preparaste</h4><p>{p.proposition}</p><p>{p.agent} · {p.action} · {p.symbol}</p><p>{p.mapping}</p><blockquote>{unit.text}</blockquote></article></div>
      <p className="field-help">La comparación ayuda a calibrarte; la aplicación no verifica automáticamente la verdad o comprensión de una respuesta abierta. Estas respuestas del examen permanecen en memoria y no se guardan.</p>
      <Check name="entrancePassed" label="Recuperé el significado y pude justificarlo sin ver la solución" value={p.entrancePassed} onChange={update} />
      <Check name="meaningConfirmed" label="Comparé mi respuesta y no encontré un error esencial" value={p.meaningConfirmed} onChange={update} />
      <button className="button button-secondary" type="button" onClick={onRework}>Corregir concepto o escena antes de publicar</button>
    </>}
  </div>
}

export default function EncodingWorkshop({ user, unitId, onBack, onPublished, onBuildSpaces }) {
  const draft = useWorkshopDraft(user.uid, unitId)
  const concepts = useLearningData(user.uid, 'concepts')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState([])
  const p = draft.payload
  const step = draft.step
  const unit = draft.context?.unit
  async function leave(buildSpaces = false) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try { await draft.flush(); if (buildSpaces) onBuildSpaces(); else onBack() }
    catch (failure) { setError(learningError(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  async function publish() {
    if (busyRef.current) return
    const problems = workshopIssues(p, unit)
    if (problems.length) { setIssues(problems); return }
    busyRef.current = true; setBusy(true); setError('')
    try { const version = await draft.flush(); await publishEncoding(db, user.uid, unitId, version); onPublished() }
    catch (failure) { setError(learningError(failure)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function go(next) {
    const problems = next > step ? workshopIssues(p, unit, next - 1) : []
    if (problems.length) { setIssues(problems); return }
    setIssues([]); draft.setStep(next)
  }
  if (!p || !draft.context) return <section className="card"><h2>Abriendo el Taller…</h2>{draft.error ? <p role="alert">{draft.error}</p> : <p role="status">Recuperando manuscrito y borrador.</p>}<button type="button" className="button" onClick={onBack}>Volver</button></section>
  if (unit.status === 'ready') return <section className="card"><h2>Esta unidad ya está codificada</h2><button type="button" className="button" onClick={onPublished}>Ver sus repasos</button></section>
  const field = (label, name, help) => <TextField label={label} name={name} value={p[name]} onChange={draft.update} help={help} />
  const check = (label, name) => <Check label={label} name={name} value={p[name]} onChange={draft.update} />
  return <section aria-labelledby="workshop-title">
    <button className="button button-quiet back-button" type="button" disabled={busy} onClick={() => leave()}>Guardar y salir del Taller</button>
    <div className="page-heading"><div><p className="eyebrow">Taller de Codificación obligatorio</p><h2 id="workshop-title">Estación {step + 1} de 8 · {WORKSHOP_STEPS[step]}</h2><p>{draft.context.source.title}</p></div><span role="status">{({ loading: 'Cargando…', pending: 'Cambios pendientes', saving: 'Guardando borrador…', saved: 'Borrador guardado', error: 'Guardado pendiente' })[draft.status]}</span></div>
    <nav aria-label="Estaciones del Taller" className="workshop-steps">{WORKSHOP_STEPS.map((label, index) => <button className="button button-secondary" type="button" key={label} disabled={busy} aria-current={index === step ? 'step' : undefined} onClick={() => go(index)}>{index + 1}. {label}</button>)}</nav>
    <GuidedStep step={step} />
    {(error || draft.error) && <div className="notice notice-error" role="alert"><p>{error || draft.error}</p><button className="button button-secondary" type="button" onClick={() => draft.flush().catch(() => {})}>Reintentar guardado</button></div>}
    {issues.length > 0 && <ul className="notice notice-error" role="alert">{issues.map((message) => <li key={message}>{message}</li>)}</ul>}
    <div className="card workshop-card"><fieldset disabled={busy}><legend className="sr-only">{WORKSHOP_STEPS[step]}</legend>
      {step === 0 && <><blockquote className="source-reading">{unit.text}</blockquote><p className="field-help">Selección exacta de la revisión {unit.sourceRevisionId}: posiciones UTF-16 {unit.startOffset}–{unit.endOffset}. El texto original permanece íntegro.</p>{check('Revisé el corte y confirma una unidad coherente', 'sourceReviewed')}</>}
      {step === 1 && <><blockquote className="source-reading">{unit.text}</blockquote><details><summary>Leer el contexto original</summary><div className="source-reading">{draft.context.revision.originalText}</div></details><div className="field"><label htmlFor="workshop-mode">Objetivo de aprendizaje</label><select id="workshop-mode" aria-describedby="guidance-mode" value={p.mode} onChange={(event) => draft.update('mode', event.target.value)}><option value="conceptual">Comprender y explicar</option><option value="literal">Recitación exacta</option><option value="dual">Comprender, explicar y recitar</option></select><ContextHelp topic="workshop.mode" context={p} descriptionId="guidance-mode" /></div><div className="field"><label htmlFor="workshop-kind">Qué hace el autor aquí</label><select id="workshop-kind" aria-describedby="guidance-conceptKind" value={p.conceptKind} onChange={(event) => draft.update('conceptKind', event.target.value)}><option value="argument">Argumento</option><option value="definition">Definición</option><option value="explanation">Explicación</option><option value="interpretation">Interpretación / imagen poética</option><option value="sequence">Secuencia</option></select><ContextHelp topic="workshop.conceptKind" context={p} descriptionId="guidance-conceptKind" /></div>{field('Términos que necesito aclarar', 'unknownTerms', 'Anota dudas; no se consideran resueltas automáticamente.')}</>}
      {step === 2 && <>{field('Concepto con mis palabras', 'proposition', 'Distingue lo que el autor sostiene de tu juicio sobre su verdad.')}{field('Términos clave', 'terms', 'Uno por línea.')}{p.conceptKind === 'argument' && <>{field('Premisas', 'premises', 'Una por línea.')}{field('Conclusión', 'conclusion')}{field('Por qué se sigue la conclusión', 'why')}</>}{check('La cita exacta es indispensable para este concepto', 'quoteNecessary')}{check('Necesito investigar antes de codificar', 'needsResearch')}</>}
      {step === 3 && <>{check('Este concepto es fundacional en mi recorrido', 'foundational')}{p.foundational ? field('Por qué es fundacional', 'foundation') : <><div className="field"><label htmlFor="linked-concept">Concepto anterior</label><select id="linked-concept" aria-describedby="guidance-linkedConceptId" value={p.linkedConceptId ?? ''} onChange={(event) => draft.update('linkedConceptId', event.target.value || null)}><option value="">Elige un concepto revisado</option>{concepts.items.filter((entry) => entry.status === 'reviewed').map((entry) => <option key={entry.id} value={entry.id}>{entry.canonicalProposition}</option>)}</select><ContextHelp topic="workshop.linkedConceptId" descriptionId="guidance-linkedConceptId" /><LearningPager data={concepts} /><ReadNotice data={concepts} /></div><div className="field"><label htmlFor="edge-type">Relación con el concepto anterior</label><select id="edge-type" aria-describedby="guidance-edgeType" value={p.edgeType} onChange={(event) => draft.update('edgeType', event.target.value)}>{[['depends_on', 'Depende de'], ['causes', 'Causa'], ['implies', 'Implica'], ['contrasts', 'Contrasta'], ['defines', 'Define'], ['example_of', 'Ejemplo de'], ['argument_order', 'Orden argumental']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ContextHelp topic="workshop.edgeType" context={p} descriptionId="guidance-edgeType" /></div>{field('Justificación de la relación', 'linkExplanation')}</>}</>}
      {step === 4 && <SpacePicker uid={user.uid} p={p} update={draft.update} onBuild={() => leave(true)} />}
      {step === 5 && <>{field('Agente de la escena', 'agent')}{field('Acción extraordinaria', 'action')}{field('Símbolo u objeto', 'symbol')}{field('Rasgo distintivo', 'distinctiveCue')}{field('Detalles sensoriales de la escena', 'sensoryDetails', 'Uno por línea.')}{field('Qué representa cada elemento', 'mapping')}{check('Ensayé mentalmente la escena en su locus', 'mentalRehearsal')}</>}
      {step === 6 && <>{field('Pregunta de recuperación sin solución', 'prompt', 'Pregunta por el sentido o la relación; no incluyas la respuesta.')}{field('Cómo distingo esta escena de las vecinas', 'distinction')}{check('Comprobé que el anclaje y la escena se distinguen', 'sceneDistinguished')}</>}
      {step === 7 && <EntranceExam p={p} unit={unit} update={draft.update} onRework={() => { draft.update('entrancePassed', false); draft.update('meaningConfirmed', false); draft.update('entranceAttempted', false); draft.setStep(5) }} />}
      <div className="actions workshop-actions"><button className="button button-secondary" type="button" disabled={step === 0} onClick={() => go(step - 1)}>Estación anterior</button>{step < 7 ? <button className="button" type="button" onClick={() => go(step + 1)}>Siguiente estación</button> : <button className="button" type="button" disabled={workshopIssues(p, unit).length > 0} onClick={publish}>{busy ? 'Publicando…' : 'Publicar codificación y tarjetas'}</button>}</div>
    </fieldset></div>
  </section>
}
