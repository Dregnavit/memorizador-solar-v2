import { useEffect, useRef, useState } from 'react'
import { createMigrationPlan, MigrationError, simulateMigration, verifyLegacyBackup } from '@icarus/domain/migration'
import { getIcarusCapabilities } from '@icarus/domain/flags'
import { db } from '../../firebase'
import { captureOwnLegacyBackup } from '../../data/firestore/backupRepository'
import { useIcarusProfile } from '../../data/hooks/useIcarusProfile'
import { errorMessage } from '../../lib'

const MAX_FILE_BYTES = 50 * 1024 * 1024

function preparationError(error) {
  if (error instanceof MigrationError) return error.message
  if (error?.name === 'ZodError' || error instanceof SyntaxError) return 'El archivo no tiene el formato de un respaldo Ícaro válido. No se modificó tu biblioteca.'
  if (error?.code) return errorMessage(error)
  return 'No se pudo comprobar el archivo. Revisa su formato; tus datos siguen intactos.'
}

function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name
  document.body.append(anchor); anchor.click(); anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function IcarusPreparation({ user, onBack }) {
  const [backup, setBackup] = useState(null)
  const [plan, setPlan] = useState(null)
  const [simulation, setSimulation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [captureCount, setCaptureCount] = useState(null)
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const controller = useRef(null)
  const profileState = useIcarusProfile(user?.uid)
  const capabilities = getIcarusCapabilities(profileState.profile, true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])

  async function perform(operation) {
    if (busyRef.current || !user?.uid) return
    busyRef.current = true; setBusy(true); setError(''); setNotice('')
    try { await operation() }
    catch (cause) { if (mounted.current) setError(preparationError(cause)) }
    finally { busyRef.current = false; if (mounted.current) setBusy(false) }
  }

  async function acceptBackup(value) {
    const verified = await verifyLegacyBackup(value, user.uid)
    const proposed = await createMigrationPlan(verified, user.uid)
    if (!mounted.current) return
    setBackup(verified); setPlan(proposed); setSimulation(null)
    setNotice('Respaldo verificado. La preparación está lista para simularse localmente.')
  }

  function capture() {
    void perform(async () => {
      setBackup(null); setPlan(null); setSimulation(null); setCaptureCount(null)
      controller.current = new AbortController()
      const value = await captureOwnLegacyBackup(db, user.uid, { signal: controller.current.signal, onProgress: (count) => { if (mounted.current) setCaptureCount(count) } })
      await acceptBackup(value)
      controller.current = null
    })
  }

  function upload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    void perform(async () => {
      setBackup(null); setPlan(null); setSimulation(null); setCaptureCount(null)
      if (file.size > MAX_FILE_BYTES) throw new MigrationError('file-too-large', 'El respaldo supera 50 MB. Usa una copia administrativa para bibliotecas mayores.')
      await acceptBackup(JSON.parse(await file.text()))
    })
  }

  function simulate() {
    void perform(async () => {
      const result = await simulateMigration(backup, user.uid)
      if (!mounted.current) return
      setSimulation(result)
      setNotice('Comprobación completada: restauración local correcta, originales intactos y segunda ejecución sin duplicados.')
    })
  }

  return (
    <section aria-labelledby="preparation-title">
      <button type="button" className="button button-secondary back-button" onClick={onBack}>← Volver a mis textos</button>
      <p className="eyebrow">El archivo del claustro</p>
      <h2 id="preparation-title">Preparación del Método Ícaro</h2>
      <p className="muted">Conserva una copia de tus manuscritos y comprueba su preparación. El repaso clásico sigue disponible.</p>
      <div className="notice" role="note"><strong>Simulación local.</strong> Aquí se comprueban fuentes y fragmentos; todavía no se crean palacios, conceptos ni tarjetas Ícaro en tu cuenta.</div>
      {profileState.status === 'unavailable' || profileState.status === 'invalid' ? <p className="notice notice-error" role="status">No se pudo verificar la configuración de preparación. Las operaciones de esta pantalla siguen siendo de lectura y simulación.</p> : null}
      {capabilities.legacyWritesLocked && <p className="notice" role="status">La biblioteca está protegida temporalmente contra cambios. Puedes consultar y capturar sus textos.</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {notice && <p className="notice notice-success" role="status">{notice}</p>}
      <div className="preparation-layout">
        <section className="card" aria-labelledby="backup-title">
          <h3 id="backup-title">Resguardar los manuscritos</h3>
          <p>La captura incluye tus textos completos, sus fragmentos y el progreso guardado.</p>
          <div className="actions"><button className="button" type="button" disabled={busy} onClick={capture}>Capturar mi biblioteca</button>{busy && controller.current && <button className="button button-secondary" type="button" onClick={() => controller.current?.abort()}>Cancelar lectura</button>}</div>
          <div className="field preparation-upload"><label htmlFor="icarus-backup-file">O abre un respaldo anterior</label><input id="icarus-backup-file" type="file" accept=".json,application/json" disabled={busy} onChange={upload} /></div>
          <p className="field-help">Solo se aceptan respaldos de tu cuenta. El archivo permanece en este navegador.</p>
          {busy && <p className="loading" role="status"><span className="spinner" aria-hidden="true" />Comprobando…{captureCount ? ` ${captureCount.textCount} textos y ${captureCount.progressCount} repasos leídos.` : ''}</p>}
          {backup && <><p className="field-help">Integridad verificada mediante hash y manifiesto.</p><code className="hash-display">{backup.backupHash}</code><button type="button" className="button button-secondary" disabled={busy} onClick={() => downloadJson(backup, `icarus-backup-${backup.backupId}.json`)}>Descargar respaldo</button></>}
        </section>
        <section className="card" aria-labelledby="simulation-title">
          <h3 id="simulation-title">Comprobar la preparación</h3>
          {!plan ? <p className="muted">Captura tu biblioteca o abre una copia para comprobar su contenido.</p> : <>
            <dl className="preparation-stats"><div><dt>Fuentes</dt><dd>{plan.summary.sourceCount}</dd></div><div><dt>Unidades</dt><dd>{plan.summary.unitCount}</dd></div><div><dt>Repasos preservados</dt><dd>{plan.summary.legacyProgressCount}</dd></div><div><dt>Fragmentos por revisar</dt><dd>{plan.summary.unresolvedCount}</dd></div></dl>
            <p>Todas las unidades requerirán elaboración conceptual y el Taller antes de entrar al repaso Ícaro.</p>
            {plan.summary.blockerCount > 0 && <p className="notice notice-error" role="alert">Hay {plan.summary.blockerCount} textos que necesitan revisión. La aplicación del plan está bloqueada y sus datos permanecen en el respaldo.</p>}
            <div className="actions"><button type="button" className="button" disabled={busy || plan.summary.blockerCount > 0} onClick={simulate}>Simular preparación</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => downloadJson(plan, `icarus-plan-${backup.backupId}.json`)}>Descargar plan</button></div>
            {simulation && <ul className="verification-list" aria-label="Comprobaciones completadas"><li>Restauración local comprobada.</li><li>Textos y progreso originales preservados.</li><li>Segunda ejecución: 0 documentos duplicados.</li><li>Tarjetas Ícaro creadas: 0.</li></ul>}
            {plan.issues.length > 0 && <details className="preparation-issues"><summary>Observaciones ({plan.issues.length})</summary><ul>{plan.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></details>}
          </>}
        </section>
      </div>
      <p className="field-help">Una captura por lecturas separadas no garantiza un snapshot simultáneo entre dispositivos. Antes de una migración real se verificará un respaldo consistente y su recuperación.</p>
    </section>
  )
}
