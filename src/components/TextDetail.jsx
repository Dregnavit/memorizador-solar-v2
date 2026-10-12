import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { errorMessage, formatReview, isDue, normalizeChunks, normalizeProgress, safeString } from '../lib'

export default function TextDetail({ user, textId, onBack, onStartStudy }) {
  const [text, setText] = useState(null)
  const [progress, setProgress] = useState({})
  const [loading, setLoading] = useState(true)
  const [progressLoading, setProgressLoading] = useState(true)
  const [textError, setTextError] = useState('')
  const [progressError, setProgressError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(Date.now())
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!db || !user?.uid || !safeString(textId).trim()) return undefined
    setLoading(true); setProgressLoading(true); setTextError(''); setProgressError(''); setProgress({})
    const stopText = onSnapshot(doc(db, 'texts', textId), (snapshot) => {
      if (!snapshot.exists()) setText(null)
      else {
        const data = snapshot.data()
        if (data?.userId !== user.uid) {
          setText(null); setTextError('Este texto no pertenece a tu cuenta.')
        } else setText({ title: safeString(data?.title).trim() || 'Texto sin título', rawText: safeString(data?.rawText), type: data?.type, chunks: normalizeChunks(data?.chunks) })
      }
      setLoading(false)
    }, (cause) => { setTextError(errorMessage(cause)); setLoading(false) })
    const stopProgress = onSnapshot(collection(db, 'texts', textId, 'progress'), (snapshot) => {
      const entries = Array.isArray(snapshot.docs) ? snapshot.docs : []
      setProgress(Object.fromEntries(entries.map((entry) => [entry.id, normalizeProgress(entry.data())])))
      setProgressLoading(false); setProgressError(''); setNow(Date.now())
    }, (cause) => { setProgressError(errorMessage(cause)); setProgressLoading(false) })
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => { stopText(); stopProgress(); window.clearInterval(timer) }
  }, [textId, user?.uid, retry])

  const chunks = useMemo(() => normalizeChunks(text?.chunks), [text?.chunks])
  const pending = useMemo(() => chunks.filter((chunk) => isDue(progress[chunk.id], now)), [chunks, progress, now])

  function reviewPending() {
    const currentPending = chunks.filter((chunk) => isDue(progress[chunk.id], Date.now()))
    if (!currentPending.length) { setNotice('No hay fragmentos pendientes. ¡Todos tus repasos están al día!'); return }
    setNotice(''); onStartStudy(currentPending)
  }

  const ready = !progressLoading && !progressError && chunks.length > 0
  return (
    <section aria-labelledby="detail-title">
      <button className="button button-secondary back-button" type="button" onClick={onBack}>← Volver a la biblioteca</button>
      {loading ? <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Cargando texto…</div> : textError ? (
        <div className="notice notice-error" role="alert"><p>{textError}</p><button className="button" type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></div>
      ) : !text ? <div className="card" role="status"><h2 id="detail-title">Texto no disponible</h2><p>Es posible que se haya eliminado desde otra sesión.</p></div> : (
        <><p className="eyebrow">{text.type === 'poesia' ? 'Poesía' : 'Prosa'} · {chunks.length} fragmentos</p><h2 id="detail-title">{text.title}</h2>
          <div className="actions detail-actions"><button className="button" type="button" disabled={!ready} onClick={() => onStartStudy(chunks)}>Estudiar Todo</button><button className="button button-secondary" type="button" disabled={!ready} onClick={reviewPending}>Repasar Pendientes{ready ? ` (${pending.length})` : ''}</button></div>
          {notice && <p className="notice notice-success" role="status">{notice}</p>}
          {progressError && <div className="notice notice-error" role="alert"><p>{progressError}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar progreso</button></div>}
          {!chunks.length && <p className="notice" role="status">Este texto no contiene fragmentos válidos para estudiar.</p>}
          <div className="detail-layout"><article className="card"><h3>Lectura completa</h3><div className={`reading ${text.type === 'poesia' ? 'reading-poetry' : ''}`} tabIndex={0} aria-label="Lectura completa del texto">{text.rawText}</div></article>
            <section className="card" aria-labelledby="chunks-title"><h3 id="chunks-title">Tus fragmentos</h3>{progressLoading ? <p role="status">Cargando progreso…</p> : (
              <ol className="chunk-list">{chunks.map((chunk, index) => {
                const review = normalizeProgress(progress[chunk.id])
                const due = isDue(review, now)
                return <li className="chunk-item" key={chunk.id}><div className="chunk-top"><strong>Fragmento {index + 1}</strong>{progressError ? <span className="badge">Estado no disponible</span> : <span className={`badge ${due ? 'badge-due' : 'badge-done'}`}>{due ? 'Pendiente' : 'Repasado'}</span>}</div><p>{chunk.text}</p>{!progressError && <small className="muted">{review.nextReview ? `Próximo repaso: ${formatReview(review.nextReview)}` : 'Sin repasar todavía'}</small>}</li>
              })}</ol>
            )}</section>
          </div>
        </>
      )}
    </section>
  )
}
