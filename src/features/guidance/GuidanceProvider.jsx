import { createContext, useContext, useEffect, useState } from 'react'
import Introduction from './Introduction.jsx'
import { DEFAULT_GUIDANCE, loadGuidancePreference, parseGuidancePreference, preferenceKey, saveGuidancePreference } from './preferences.js'

const GuidanceContext = createContext({ ...DEFAULT_GUIDANCE, openIntroduction() {}, dismissWelcome() {}, setMode() {}, storageAvailable: true })
export const useGuidance = () => useContext(GuidanceContext)

function load(uid) {
  try { return uid ? loadGuidancePreference(uid, window.localStorage) : { preference: { ...DEFAULT_GUIDANCE }, available: true } }
  catch { return { preference: { ...DEFAULT_GUIDANCE }, available: false } }
}

export default function GuidanceProvider({ userId, children }) {
  // App keys this provider by UID; presentation preferences never migrate between accounts.
  const [initial] = useState(() => load(userId))
  const [preference, setPreference] = useState(initial.preference)
  const [storageAvailable, setStorageAvailable] = useState(initial.available)
  const [introOpen, setIntroOpen] = useState(false)
  useEffect(() => {
    if (!userId) return
    try { setStorageAvailable(saveGuidancePreference(userId, preference, window.localStorage)) }
    catch { setStorageAvailable(false) }
  }, [preference, userId])
  useEffect(() => {
    if (!userId) return undefined
    function changed(event) {
      if (event.key === preferenceKey(userId)) setPreference(parseGuidancePreference(event.newValue))
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [userId])
  function dismissWelcome() {
    setPreference((current) => current.introduction === 'new' ? { ...current, introduction: 'skipped' } : current)
    setIntroOpen(false)
  }
  const value = {
    ...preference, storageAvailable, introOpen,
    setMode(mode) { if (['guided', 'normal'].includes(mode)) setPreference((current) => ({ ...current, mode })) },
    openIntroduction() { setIntroOpen(true) }, dismissWelcome,
    completeIntroduction() { setPreference((current) => ({ ...current, introduction: 'completed' })); setIntroOpen(false) },
  }
  return <GuidanceContext.Provider value={value}>{children}</GuidanceContext.Provider>
}

export function GuidanceIntroduction() {
  const guidance = useGuidance()
  return guidance.introOpen ? <Introduction onClose={guidance.dismissWelcome} onComplete={guidance.completeIntroduction} /> : null
}

export function GuidanceControls() {
  const guidance = useGuidance()
  return <div className="guidance-controls" data-guidance><div className="theme-control"><label htmlFor="guidance-level">Nivel de ayuda</label><select id="guidance-level" value={guidance.mode} onChange={(event) => guidance.setMode(event.target.value)} aria-describedby="guidance-level-description"><option value="guided">Modo Guiado</option><option value="normal">Modo Normal</option></select></div><span id="guidance-level-description" className="sr-only">Guiado muestra instrucciones breves. Normal conserva la ayuda desplegable. No cambia tus respuestas ni las validaciones.</span><button className="button button-secondary" type="button" onClick={guidance.openIntroduction}>Cómo funciona</button></div>
}

export function GuidanceWelcome() {
  const guidance = useGuidance()
  return <>{!guidance.storageAvailable && <p className="notice" role="status">No se puede guardar la preferencia de ayuda en este navegador. Tu elección se mantiene durante esta sesión.</p>}{guidance.introduction === 'new' && <aside className="card guidance-welcome" aria-label="Bienvenida al modo guiado" data-guidance><div><strong>Aprende a recorrer tu memoria</strong><p>Una introducción opcional enseña lugares, manuscritos, imágenes y repasos con pequeñas prácticas. Puedes volver a consultarla cuando quieras.</p></div><div className="actions"><button className="button" type="button" onClick={guidance.openIntroduction}>Comenzar introducción</button><button className="button button-secondary" type="button" onClick={guidance.dismissWelcome}>Saltar introducción</button></div></aside>}</>
}
