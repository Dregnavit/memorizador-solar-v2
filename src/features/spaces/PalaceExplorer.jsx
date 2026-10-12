import { useEffect, useRef, useState } from 'react'
import { db } from '../../firebase.js'
import { errorMessage } from '../../lib.js'
import { MigrationError } from '@icarus/domain/migration'
import { createSpace, newSpaceIntent, setSpaceArchived } from '../../data/firestore/spacesRepository.js'
import { useSpaces } from '../../data/hooks/useSpaces.js'

const LABELS = { palace: 'palacio', macro: 'macro-estación', locus: 'locus' }
const STATES = { free: 'Libre', reserved: 'Reservado', occupied: 'Ocupado', cooling: 'En descanso', archived: 'Archivado' }
const isArchived = (item) => item?.lifecycle === 'archived' || item?.state === 'archived'
const titleOf = (item) => item?.title ?? item?.name ?? ''
const cueOf = (item) => item?.description ?? item?.spatialCue ?? item?.anchorDescription ?? ''
const hasDependents = (kind, item) => kind === 'palace' ? item.activeMacroCount > 0 : kind === 'macro' ? item.activeLocusCount > 0 : Boolean(item.activeEncodingId) || !['free', 'archived'].includes(item.state)
const explainError = (error) => error instanceof MigrationError ? error.message : error?.name === 'ZodError' ? 'Revisa el nombre, el anclaje y el orden de la estación.' : errorMessage(error)

function SpaceForm({ userId, kind, palaceId, macroId, onClose, onCreated }) {
  const dialog = useRef(null)
  const active = useRef(true)
  const busy = useRef(false)
  const intent = useRef(null)
  const [name, setName] = useState('')
  const [cue, setCue] = useState('')
  const [ordinal, setOrdinal] = useState('0')
  const [senses, setSenses] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    active.current = true
    const node = dialog.current
    if (node && !node.open) node.showModal()
    return () => { active.current = false; node?.close() }
  }, [])

  async function save(event) {
    event.preventDefault()
    if (busy.current || !db) return
    const input = { kind, name: name.trim(), cue: cue.trim(), ordinal: Number(ordinal), sensoryCues: senses.split('\n').map((value) => value.trim()).filter(Boolean) }
    if (kind !== 'palace') input.palaceId = palaceId
    if (kind === 'locus') input.macroId = macroId
    if (!input.name || (kind !== 'palace' && !input.cue)) { setError('Escribe un nombre y un anclaje concreto para reconocer este lugar.'); return }
    if (input.sensoryCues.length > 6) { setError('Puedes añadir hasta seis señales sensoriales, una por línea.'); return }
    const serialized = JSON.stringify(input)
    if (intent.current?.input !== serialized) intent.current = { input: serialized, id: newSpaceIntent(db, userId, kind) }
    busy.current = true; setSaving(true); setError('')
    try {
      const result = await createSpace(db, userId, input, intent.current.id)
      if (active.current) onCreated(result.id)
    } catch (failure) { if (active.current) setError(explainError(failure)) }
    finally { busy.current = false; if (active.current) setSaving(false) }
  }
  return (
    <dialog ref={dialog} className="modal card" aria-labelledby="space-form-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose() }}>
      <div className="modal-heading"><h2 id="space-form-title">Crear {LABELS[kind]}</h2><button className="button button-quiet" type="button" disabled={saving} onClick={onClose} aria-label="Cerrar formulario de estación">×</button></div>
      <form onSubmit={save}><fieldset disabled={saving}><legend className="sr-only">Identidad y ubicación espacial</legend>
        <div className="field"><label htmlFor="space-name">Nombre</label><input id="space-name" autoFocus required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></div>
        <div className="field"><label htmlFor="space-cue">{kind === 'palace' ? 'Descripción del palacio' : 'Anclaje espacial'}</label><textarea id="space-cue" required={kind !== 'palace'} maxLength={4000} value={cue} onChange={(event) => setCue(event.target.value)} aria-describedby="space-cue-help" /><p id="space-cue-help" className="field-help">{kind === 'palace' ? 'Elige un lugar familiar, real o imaginado, que puedas recorrer de forma estable.' : 'Describe un lugar reconocible: su posición, su forma y qué lo distingue de sus vecinos.'}</p></div>
        {kind !== 'palace' && <div className="field"><label htmlFor="space-order">Orden en el recorrido</label><input id="space-order" type="number" required min="0" max="1000000" step="1" value={ordinal} onChange={(event) => setOrdinal(event.target.value)} /><p className="field-help">Un número menor aparece antes. Los empates conservan un orden estable por ID.</p></div>}
        {kind === 'locus' && <div className="field"><label htmlFor="space-senses">Señales sensoriales (opcionales)</label><textarea id="space-senses" maxLength={1205} value={senses} onChange={(event) => setSenses(event.target.value)} aria-describedby="space-senses-help" /><p id="space-senses-help" className="field-help">Una por línea; hasta seis, de 200 caracteres cada una. Por ejemplo: tacto de la piedra, olor a madera, sonido del agua.</p></div>}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button" type="submit">{saving ? 'Guardando…' : 'Guardar estación'}</button></div>
      </fieldset></form>
    </dialog>
  )
}

function SpaceColumn({ kind, heading, description, data, selectedId, onSelect, onCreate, canCreate, showArchived, busy, onArchive }) {
  const items = Array.isArray(data.items) ? data.items.filter((item) => showArchived || !isArchived(item)) : []
  return (
    <section className="card space-column" aria-label={heading}>
      <div className="space-column-heading"><h3>{heading}</h3><button type="button" className="button button-secondary" disabled={!canCreate || busy} onClick={onCreate}>+ {LABELS[kind]}</button></div>
      <p className="muted">{description}</p>
      {data.loading && <p role="status">Cargando estaciones…</p>}
      {data.error && <div className="notice notice-error" role="alert"><p>{data.error}</p><button type="button" className="button button-secondary" onClick={data.retry}>Reintentar lectura</button></div>}
      {!data.loading && !data.error && !items.length && <p className="space-empty">{canCreate ? 'Este espacio todavía está por construir.' : 'Selecciona una estación superior para recorrer sus lugares.'}</p>}
      <ul className="space-list">{items.map((item) => (
        <li className={`space-item ${item.id === selectedId ? 'space-selected' : ''}`} key={item.id}>
          <button className="space-select" type="button" aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id)} aria-label={`Seleccionar ${LABELS[kind]} ${titleOf(item)}`}><strong>{titleOf(item)}</strong><span>{cueOf(item)}</span></button>
          <div className="space-item-meta"><span className={`badge ${isArchived(item) ? '' : kind === 'locus' && item.state === 'free' ? 'badge-done' : ''}`}>{kind === 'locus' ? STATES[item.state] : isArchived(item) ? 'Archivado' : 'Activo'}</span><span>{kind === 'palace' ? `${item.activeMacroCount} macro-estaciones activas` : kind === 'macro' ? `${item.activeLocusCount} loci activos` : `Lugar ${item.ordinal}`}</span></div>
          {kind === 'locus' && item.sensoryCues.length > 0 && <p className="field-help">{item.sensoryCues.join(' · ')}</p>}
          <button type="button" className="button button-quiet" disabled={busy || hasDependents(kind, item)} onClick={() => onArchive(kind, item)} aria-label={`${isArchived(item) ? 'Restaurar' : 'Archivar'} ${LABELS[kind]} ${titleOf(item)}`}>{isArchived(item) ? 'Restaurar' : 'Archivar'}</button>
          {hasDependents(kind, item) && <p className="field-help">{kind === 'locus' ? 'Su codificación activa conserva este anclaje.' : 'Archiva primero sus estaciones activas.'}</p>}
        </li>
      ))}</ul>
      {(data.hasMore || data.canGoBack) && <div className="space-pagination"><button className="button button-secondary" type="button" disabled={!data.canGoBack || data.loading || busy} onClick={data.previousPage}>Anterior</button><span>Página {data.pageNumber}</span><button className="button button-secondary" type="button" disabled={!data.hasMore || data.loading || busy} onClick={data.nextPage}>Siguiente</button></div>}
    </section>
  )
}

export default function PalaceExplorer({ user, onBack }) {
  const [palaceId, setPalaceId] = useState(null)
  const [macroId, setMacroId] = useState(null)
  const [locusId, setLocusId] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const active = useRef(true)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const palaces = useSpaces(user?.uid, 'palace')
  const macros = useSpaces(user?.uid, 'macro', palaceId)
  const loci = useSpaces(user?.uid, 'locus', macroId)
  const palace = palaces.items.find((item) => item.id === palaceId)
  const macro = macros.items.find((item) => item.id === macroId)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!palaces.loading && (!palace || (!showArchived && isArchived(palace)))) { setPalaceId(null); setMacroId(null); setLocusId(null) }
  }, [palaces.loading, palace, showArchived])
  useEffect(() => {
    if (!macros.loading && (!macro || (!showArchived && isArchived(macro)))) { setMacroId(null); setLocusId(null) }
  }, [macros.loading, macro, showArchived])

  async function archive(kind, item) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setNotice(''); setError('')
    try {
      await setSpaceArchived(db, user.uid, { kind, id: item.id, archived: !isArchived(item), expectedVersion: item.version })
      if (active.current) setNotice(isArchived(item) ? 'Estación restaurada. Su identidad y anclaje se conservan.' : 'Estación archivada. Puedes restaurarla desde «Mostrar archivados».')
    } catch (failure) { if (active.current) setError(explainError(failure)) }
    finally { busyRef.current = false; if (active.current) setBusy(false) }
  }
  function created() {
    setForm(null); setNotice('Estación creada. Ya forma parte de tu recorrido.'); setError('')
  }
  return (
    <section aria-labelledby="palace-explorer-title">
      <button className="button button-quiet back-button" type="button" disabled={busy} onClick={onBack}>← Volver a mis textos</button>
      <div className="page-heading"><div><p className="eyebrow">Arquitectura de la memoria</p><h2 id="palace-explorer-title">Tus palacios de memoria</h2><p className="muted">Un palacio reúne macro-estaciones. Cada locus es un lugar estable donde alojar una escena mnemónica.</p></div><label className="space-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Mostrar archivados</label></div>
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <p className="space-breadcrumb" aria-live="polite">{palace ? titleOf(palace) : 'Elige un palacio'}{macro ? ` / ${titleOf(macro)}` : ''}</p>
      <div className="space-grid">
        <SpaceColumn kind="palace" heading="Palacios" description="El escenario familiar que contiene el recorrido." data={palaces} selectedId={palaceId} showArchived={showArchived} busy={busy} canCreate onSelect={(id) => { setPalaceId(id); setMacroId(null); setLocusId(null) }} onCreate={() => setForm('palace')} onArchive={archive} />
        <SpaceColumn kind="macro" heading="Macro-estaciones" description="Salas, patios o tramos claramente diferenciados." data={macros} selectedId={macroId} showArchived={showArchived} busy={busy} canCreate={Boolean(palace && !isArchived(palace))} onSelect={(id) => { setMacroId(id); setLocusId(null) }} onCreate={() => setForm('macro')} onArchive={archive} />
        <SpaceColumn kind="locus" heading="Loci · micro-estaciones" description="Un anclaje concreto y reconocible en cada lugar." data={loci} selectedId={locusId} showArchived={showArchived} busy={busy} canCreate={Boolean(palace && !isArchived(palace) && macro && !isArchived(macro))} onSelect={setLocusId} onCreate={() => setForm('locus')} onArchive={archive} />
      </div>
      {form && <SpaceForm key={`${form}-${palaceId}-${macroId}`} userId={user.uid} kind={form} palaceId={palaceId} macroId={macroId} onClose={() => setForm(null)} onCreated={created} />}
    </section>
  )
}
