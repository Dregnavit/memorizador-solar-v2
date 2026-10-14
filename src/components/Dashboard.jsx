import ContextHelp from '../features/guidance/ContextHelp.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { errorMessage, MAX_CHUNKS, MAX_TEXT_LENGTH, normalizeChunks, previewText, safeString, splitText } from '../lib'

export default function Dashboard({ user, onOpenText }) {
  const [texts, setTexts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [rawText, setRawText] = useState('')
  const [type, setType] = useState('prosa')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const dialog = useRef(null)
  const savingRef = useRef(false)
  const deletingRef = useRef(false)
  const chunks = useMemo(() => splitText(rawText, type), [rawText, type])

  useEffect(() => {
    if (!db || !user?.uid) return undefined
    setLoading(true)
    setError('')
    const textsQuery = query(collection(db, 'texts'), where('userId', '==', user.uid))
    return onSnapshot(textsQuery, (snapshot) => {
      const entries = Array.isArray(snapshot.docs) ? snapshot.docs.map((entry) => {
        const data = entry.data()
        return {
          id: entry.id,
          title: safeString(data?.title).trim() || 'Texto sin título',
          rawText: safeString(data?.rawText),
          type: data?.type === 'poesia' ? 'poesia' : 'prosa',
          chunks: normalizeChunks(data?.chunks),
          createdAt: data?.createdAt?.toMillis?.() || 0,
        }
      }) : []
      entries.sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title, 'es'))
      setTexts(entries)
      setLoading(false)
      setError('')
    }, (cause) => { setError(errorMessage(cause)); setLoading(false) })
  }, [user?.uid, retry])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  function openForm() {
    setTitle(''); setRawText(''); setType('prosa'); setFormError(''); setNotice('')
    setOpen(true)
  }

  async function createText(event) {
    event.preventDefault()
    if (savingRef.current || !db || !user?.uid) return
    const cleanTitle = safeString(title).trim()
    const cleanText = safeString(rawText).trim()
    if (!cleanTitle || !cleanText || !Array.isArray(chunks) || !chunks.length) {
      setFormError('Escribe un título y al menos un fragmento de texto.'); return
    }
    if (cleanTitle.length > 120 || cleanText.length > MAX_TEXT_LENGTH || chunks.length > MAX_CHUNKS) {
      setFormError(`Usa un título de hasta 120 caracteres, un texto de hasta ${MAX_TEXT_LENGTH} caracteres y un máximo de ${MAX_CHUNKS} fragmentos.`); return
    }
    savingRef.current = true
    setSaving(true); setFormError('')
    try {
      await addDoc(collection(db, 'texts'), { userId: user.uid, title: cleanTitle, rawText: cleanText, type, chunks, createdAt: serverTimestamp() })
      setOpen(false); setNotice('Texto guardado. Ya puedes comenzar a estudiar.')
    } catch (cause) { setFormError(errorMessage(cause)) }
    finally { savingRef.current = false; setSaving(false) }
  }

  async function removeText(text) {
    if (deletingRef.current || !db || !user?.uid || !text?.id) return
    if (!window.confirm(`¿Eliminar «${safeString(text.title)}» y todo su progreso? Esta acción no se puede deshacer.`)) return
    deletingRef.current = true
    setDeletingId(text.id); setError(''); setNotice('')
    try {
      const progress = await getDocs(collection(db, 'texts', text.id, 'progress'))
      const documents = Array.isArray(progress.docs) ? progress.docs : []
      for (let offset = 0; offset < documents.length; offset += 450) {
        const batch = writeBatch(db)
        documents.slice(offset, offset + 450).forEach((entry) => batch.delete(entry.ref))
        await batch.commit()
      }
      await deleteDoc(doc(db, 'texts', text.id))
      setNotice('Texto y progreso eliminados.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { deletingRef.current = false; setDeletingId(null) }
  }

  return (
    <section aria-labelledby="dashboard-title">
      <ContextHelp topic="classic.overview" />
      <div className="page-heading"><div><p className="eyebrow">Tu biblioteca</p><h2 id="dashboard-title">Palabras que permanecen</h2><p className="muted">Transforma tus lecturas en pequeños ejercicios de memoria.</p></div><button type="button" className="button" onClick={openForm}>+ Nuevo Texto</button></div>
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {error && <div className="notice notice-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => setRetry((value) => value + 1)}>Reintentar</button></div>}
      {loading ? <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Cargando textos…</div> : !texts.length && !error ? (
        <div className="card empty-state"><div className="empty-icon" aria-hidden="true">☀</div><h3>Tu biblioteca comienza aquí</h3><p className="muted">Añade una poesía o un texto en prosa para crear tus primeras tarjetas.</p><button className="button button-secondary" type="button" onClick={openForm}>Crear mi primer texto</button></div>
      ) : (
        <div className="text-grid">{Array.isArray(texts) && texts.map((text) => (
          <article className="card text-card" key={text.id}>
            <div className="text-meta"><span>{text.type === 'poesia' ? 'Poesía' : 'Prosa'}</span><span>·</span><span>{Array.isArray(text.chunks) ? text.chunks.length : 0} fragmentos</span></div>
            <h3>{text.title}</h3><p className="text-preview">{previewText(text.rawText)}</p>
            <div className="actions"><button className="button" type="button" onClick={() => onOpenText(text.id)} aria-label={`Abrir ${text.title}`}>Abrir texto</button><button type="button" className="button button-danger" disabled={Boolean(deletingId)} onClick={() => removeText(text)} aria-label={`Eliminar ${text.title}`}>{deletingId === text.id ? 'Eliminando…' : 'Eliminar'}</button></div>
          </article>
        ))}</div>
      )}
      <dialog ref={dialog} className="modal card" aria-labelledby="new-text-title" onCancel={(event) => { event.preventDefault(); if (!savingRef.current) setOpen(false) }}>
        <div className="modal-heading"><h2 id="new-text-title">Nuevo texto</h2><button className="button button-quiet" type="button" disabled={saving} onClick={() => setOpen(false)} aria-label="Cerrar formulario">×</button></div>
        <form onSubmit={createText}><fieldset disabled={saving}><legend className="sr-only">Contenido del nuevo texto</legend>
          <div className="field"><label htmlFor="text-title">Título</label><input id="text-title" aria-describedby="guide-text-title" required maxLength={120} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /><ContextHelp topic="classic.title" descriptionId="guide-text-title" /></div>
          <div className="field"><label htmlFor="text-type">Tipo de texto</label><select id="text-type" aria-describedby="guide-text-type" value={type} onChange={(event) => setType(event.target.value)}><option value="prosa">Prosa</option><option value="poesia">Poesía</option></select><ContextHelp topic="classic.type" descriptionId="guide-text-type" /></div>
          <div className="field"><label htmlFor="text-content">Texto completo</label><textarea id="text-content" required maxLength={MAX_TEXT_LENGTH} value={rawText} onChange={(event) => setRawText(event.target.value)} aria-describedby="fragment-help guide-text-content" /><ContextHelp topic="classic.text" descriptionId="guide-text-content" /><p id="fragment-help" className="field-help">{type === 'poesia' ? 'Cada verso será un fragmento.' : 'Cada oración o salto de línea será un fragmento.'} {chunks.length} fragmentos · {rawText.length.toLocaleString('es')} / {MAX_TEXT_LENGTH.toLocaleString('es')} caracteres.</p></div>
          {formError && <p className="notice notice-error" role="alert">{formError}</p>}
          <div className="actions"><button className="button button-secondary" type="button" onClick={() => setOpen(false)}>Cancelar</button><button className="button" type="submit">{saving ? 'Guardando…' : 'Guardar texto'}</button></div>
        </fieldset></form>
      </dialog>
    </section>
  )
}
