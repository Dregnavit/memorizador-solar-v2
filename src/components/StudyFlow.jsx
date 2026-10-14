import ContextHelp from '../features/guidance/ContextHelp.jsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { calculateReview, errorMessage, normalizeChunks } from '../lib'

const RATINGS = [{ value: 1, label: 'Repetir', hint: 'Ahora' }, { value: 2, label: 'Difícil', hint: 'Más práctica' }, { value: 3, label: 'Bueno', hint: 'Lo recordé' }, { value: 4, label: 'Fácil', hint: 'Sin esfuerzo' }]

export default function StudyFlow({ user, textId, chunks, onFinish, onCancel }) {
  const cards = useMemo(() => normalizeChunks(chunks), [chunks])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const mounted = useRef(false)
  const current = cards[index]

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const rate = useCallback(async (rating) => {
    if (!revealed || savingRef.current || !current || !db || !user?.uid || !textId) return
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const reference = doc(db, 'texts', textId, 'progress', current.id)
      const snapshot = await getDoc(reference)
      if (!mounted.current) return
      const review = calculateReview(snapshot.exists() ? snapshot.data() : undefined, rating)
      const batch = writeBatch(db)
      batch.set(reference, review)
      await batch.commit()
      if (!mounted.current) return
      if (index + 1 >= cards.length) onFinish()
      else { setIndex((value) => value + 1); setRevealed(false) }
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }, [revealed, current, user?.uid, textId, index, cards.length, onFinish])

  useEffect(() => {
    function keydown(event) {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || savingRef.current || event.target?.closest?.('dialog, [data-guidance], summary')) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return
      if (event.code === 'Space' || event.key === 'Enter') {
        if (target instanceof HTMLElement && target.closest('button, a')) return
        event.preventDefault()
        setRevealed(true)
      } else if (revealed && /^[1-4]$/.test(event.key)) {
        event.preventDefault()
        void rate(Number(event.key))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [revealed, rate])

  if (!current) return <section className="card" role="status"><h2>No hay fragmentos para estudiar</h2><button className="button" type="button" onClick={onCancel}>Volver al texto</button></section>

  return (
    <section className="study-shell" aria-labelledby="study-title" aria-busy={saving}>
      <div className="study-header"><div><p className="eyebrow">Método Ícaro</p><h2 id="study-title">Fragmento {index + 1} de {cards.length}</h2></div><button className="button button-secondary" type="button" disabled={saving} onClick={onCancel}>Volver al texto</button></div>
      <ContextHelp topic="classic.study" /><progress className="study-progress" value={index} max={cards.length} aria-label={`${index} de ${cards.length} fragmentos completados`} />
      <div className="card flashcard" aria-live="polite" aria-atomic="true">
        {revealed ? <p className="flashcard-text">{current.text}</p> : <div className="recall-prompt"><h3>Haz espacio a la memoria</h3><p>Intenta recitar el fragmento antes de revelarlo.<br />Después, evalúa cuánto recordaste.</p></div>}
      </div>
      {error && <p className="notice notice-error" role="alert">{error} El fragmento sigue aquí; puedes volver a calificarlo.</p>}
      {revealed ? <><div className="rating-grid" aria-label="Califica tu recuerdo">{RATINGS.map((rating) => <button key={rating.value} type="button" className="button rating-button" disabled={saving} onClick={() => void rate(rating.value)} aria-label={`${rating.value}: ${rating.label}`}><strong>{rating.label}</strong><small>{rating.hint} · {rating.value}</small></button>)}</div><p className="keyboard-help" role="status">{saving ? 'Guardando progreso…' : 'Elige una calificación o pulsa 1, 2, 3 o 4.'}</p></> : <div className="study-reveal"><button className="button" type="button" onClick={() => setRevealed(true)}>Revelar / Memorizar</button><p className="keyboard-help">También puedes usar <kbd>Espacio</kbd> o <kbd>Enter</kbd>.</p></div>}
    </section>
  )
}
