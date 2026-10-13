import { useEffect, useReducer, useRef, useState } from 'react'
import { literalDiff, maximumRating, newRecall, RATINGS, recallReducer } from '@icarus/domain/review'
import { db } from '../../firebase.js'
import { readReviewContext, submitReview } from '../../data/firestore/cognitiveRepository.js'
import { learningError, TARGET_LABELS } from './messages.js'

const LABELS = { again: '1 · Repetir', hard: '2 · Difícil', good: '3 · Bueno', easy: '4 · Fácil' }
const QUESTIONS = { SCENE_RECALL: '¿Qué sucede en este lugar?', MEANING_RECALL: '¿Qué representa la escena, con tus palabras?', STRUCTURE: 'Explica una relación, inferencia o ejemplo de esta idea', VERBATIM: 'Recita o escribe exactamente el fragmento original' }
function ReviewCard({ user, data, position, total, onNext, onCancel }) {
  const [context, dispatch] = useReducer(recallReducer, data.card.target, newRecall)
  const [answer, setAnswer] = useState('')
  const [retain, setRetain] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const intent = useRef(null)
  const mounted = useRef(true)
  const focusTarget = useRef(null)
  const { card, unit, encoding, concept, locus } = data
  const cap = maximumRating(context)
  const recallPhase = Boolean(QUESTIONS[context.phase])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { focusTarget.current?.focus() }, [context.phase])
  function next() { dispatch({ type: 'NEXT', attempt: answer }); setAnswer('') }
  async function rate(rating) {
    if (busy.current || context.phase !== 'RATE' || RATINGS.indexOf(rating) > RATINGS.indexOf(cap)) return
    busy.current = true; setError('')
    const payload = { context, rating, retain }
    const signature = JSON.stringify(payload)
    if (!intent.current || intent.current.signature !== signature) intent.current = { signature, id: crypto.randomUUID(), ...payload }
    dispatch({ type: 'COMMIT', rating })
    try {
      await submitReview(db, user.uid, card.id, card.version, intent.current.context, intent.current.rating, intent.current.id, intent.current.retain)
      if (mounted.current) { dispatch({ type: 'DONE' }); onNext() }
    } catch (failure) { if (mounted.current) { setError(learningError(failure)); dispatch({ type: 'RETRY' }) } }
    finally { busy.current = false }
  }
  useEffect(() => {
    function keydown(event) {
      const element = event.target
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element?.tagName)) return
      if (context.phase === 'RATE' && /^[1-4]$/.test(event.key)) { event.preventDefault(); rate(RATINGS[Number(event.key) - 1]) }
      else if (context.phase === 'ORIENT' && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); dispatch({ type: 'NEXT' }) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
    // rate depends on the current context; reinstall when that context changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, cap, retain])
  return <section className="card stepped-review" aria-labelledby="review-title">
    <div className="page-heading"><div><p className="eyebrow">Repaso Escalonado · {TARGET_LABELS[card.target]}</p><h2 id="review-title" ref={focusTarget} tabIndex={-1}>Tarjeta {position} de {total}</h2></div><button className="button button-secondary" type="button" disabled={context.phase === 'COMMIT'} onClick={onCancel}>Terminar sesión Ícaro</button></div>
    {error && <p className="notice notice-error" role="alert">{error} Tu intento permanece en esta tarjeta para reintentar.</p>}
    {!context.revealed && <div className="locus-cue"><h3>{locus.name}</h3><p>{locus.anchorDescription}</p><p className="field-help">Ubícate mentalmente. La escena y la fuente se mostrarán después de tu intento.</p></div>}
    {context.phase === 'ORIENT' && <><p>{card.target === 'verbatim' ? 'Recupera las palabras exactas desde este anclaje.' : encoding.retrievalPrompt}</p><button className="button" type="button" onClick={next}>Comenzar recuperación</button></>}
    {recallPhase && <><div className="field"><label htmlFor="recall-answer">{QUESTIONS[context.phase]}</label><textarea id="recall-answer" maxLength={4000} rows={5} value={answer} onChange={(event) => setAnswer(event.target.value)} autoFocus /></div>
      {context.highestHint > 0 && <div className="notice" role="status"><strong>Pista H{context.highestHint}</strong><p>{context.highestHint === 1 ? 'Busca una sensación y una acción: ¿qué ves, oyes o sientes en ese lugar?' : context.highestHint === 2 ? `El agente de tu escena: ${encoding.scene.agent}. Tipo de concepto: ${concept.kind}.` : concept.canonicalProposition.split(/\s+/).slice(0, 8).join(' ')}</p><p className="field-help">Tope por ayuda: {context.highestHint === 1 ? 'Bueno' : context.highestHint === 2 ? 'Difícil' : 'Repetir'}.</p></div>}
      <div className="actions"><button className="button" type="button" disabled={!answer.trim()} onClick={next}>Registrar intento y continuar</button><button className="button button-secondary" type="button" disabled={!answer.trim() || context.highestHint >= 3} onClick={() => dispatch({ type: 'HINT', attempt: answer })}>Solicitar pista tras mi intento</button><button className="button button-secondary" type="button" onClick={() => dispatch({ type: 'FAIL' })}>No recuerdo</button></div>
    </>}
    {context.phase === 'REVEAL' && <>
      <div className="learning-comparison"><article><h3>Tu recuperación</h3>{Object.entries(context.attempts).map(([stage, text]) => <div key={stage}><h4>{QUESTIONS[stage]}</h4><p>{text}</p></div>)}{context.failed && <p>Marcaste «No recuerdo»; corresponde Repetir para este objetivo.</p>}</article><article><h3>Contrastar con la fuente</h3><p><strong>Concepto:</strong> {concept.canonicalProposition}</p>{concept.kind === 'argument' && <><p><strong>Premisas:</strong> {concept.premises.join(' · ')}</p><p><strong>Conclusión:</strong> {concept.conclusion}</p><p><strong>Justificación:</strong> {concept.whyItFollows}</p></>}<p><strong>Escena:</strong> {encoding.scene.agent} · {encoding.scene.action} · {encoding.scene.symbol}</p><p>{encoding.scene.conceptMapping}</p><blockquote className="source-reading">{unit.text}</blockquote></article></div>
      {card.target === 'verbatim' && <p className="notice" role="status">{literalDiff(unit.text, context.attempts.VERBATIM).exact ? 'La recitación coincide exactamente con el original.' : `La recitación difiere del original. Primer cambio en el carácter ${literalDiff(unit.text, context.attempts.VERBATIM).firstDifference + 1}; revisa palabras, puntuación y saltos de línea.`}</p>}
      <p className="field-help">Evalúa tu recuerdo antes de ver la solución. Una paráfrasis válida no necesita copiar el original; la recitación exacta sí conserva sus palabras y puntuación.</p>
      <div className="review-checklist">{card.target !== 'verbatim' && <label className="learning-check"><input type="checkbox" checked={context.checklist.mainIdea} onChange={(event) => dispatch({ type: 'CHECK', key: 'mainIdea', value: event.target.checked })} /> Recuperé la idea central antes de revelar</label>}{card.target === 'explanation' && <label className="learning-check"><input type="checkbox" checked={context.checklist.explanation} onChange={(event) => dispatch({ type: 'CHECK', key: 'explanation', value: event.target.checked })} /> Expliqué correctamente la relación o el ejemplo</label>}{card.target === 'verbatim' && <label className="learning-check"><input type="checkbox" checked={context.checklist.exact} disabled={!literalDiff(unit.text, context.attempts.VERBATIM).exact} onChange={(event) => dispatch({ type: 'CHECK', key: 'exact', value: event.target.checked })} /> Recité exactamente antes de revelar</label>}<label className="learning-check"><input type="checkbox" checked={context.checklist.noCriticalError} onChange={(event) => dispatch({ type: 'CHECK', key: 'noCriticalError', value: event.target.checked })} /> No hubo error esencial ni confusión con otra idea</label></div>
      <button className="button" type="button" onClick={next}>Continuar a la calificación</button>
    </>}
    {context.phase === 'RATE' && <><p role="status">Nota máxima permitida: {LABELS[cap]}. Repetir es olvido; Difícil es recuerdo logrado con esfuerzo.</p><label className="learning-check"><input type="checkbox" checked={retain} onChange={(event) => setRetain(event.target.checked)} /> Conservar mis respuestas de este repaso en mi historial privado</label><p className="field-help">Por defecto se guardan solo metadatos. Este consentimiento afecta únicamente a esta tarjeta.</p><div className="review-ratings">{RATINGS.map((rating) => <button className="button" type="button" key={rating} disabled={RATINGS.indexOf(rating) > RATINGS.indexOf(cap)} onClick={() => rate(rating)}>{LABELS[rating]}</button>)}</div><p className="field-help">Atajos 1–4 fuera de los campos. La agenda de este objetivo se actualiza con FSRS después de confirmar el guardado.</p></>}
    {context.phase === 'COMMIT' && <p role="status">Guardando el repaso y su nueva agenda…</p>}
  </section>
}

export default function SteppedReview({ user, queue, onFinish }) {
  const [index, setIndex] = useState(0)
  const [state, setState] = useState({ data: null, error: '' })
  const cardId = queue[index]?.id
  useEffect(() => {
    let active = true
    setState({ data: null, error: '' })
    if (cardId) readReviewContext(db, user.uid, cardId).then((data) => { if (active) setState({ data, error: '' }) }).catch((failure) => { if (active) setState({ data: null, error: learningError(failure) }) })
    return () => { active = false }
  }, [cardId, user.uid])
  function next() { if (index + 1 >= queue.length) onFinish(true); else setIndex((value) => value + 1) }
  if (!state.data) return <section className="card"><h2>Preparando recuperación</h2>{state.error ? <p role="alert">{state.error}</p> : <p role="status">Cargando la tarjeta y su anclaje…</p>}<button className="button button-secondary" type="button" onClick={() => onFinish(false)}>Volver sin modificar la agenda</button></section>
  return <ReviewCard key={cardId} user={user} data={state.data} position={index + 1} total={queue.length} onNext={next} onCancel={() => onFinish(false)} />
}
