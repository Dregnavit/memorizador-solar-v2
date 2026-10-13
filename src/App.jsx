import { Component, lazy, Suspense, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth, configurationError } from './firebase'
import { errorMessage, normalizeChunks } from './lib'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import TextDetail from './components/TextDetail'
import StudyFlow from './components/StudyFlow'
import './App.css'

const THEMES = ['medieval', 'light', 'dark']
const PREPARATION_ENABLED = import.meta.env.VITE_ICARUS_PREPARATION_ENABLED === 'true'
const SPACES_ENABLED = import.meta.env.VITE_ICARUS_SPACES_ENABLED === 'true'
const LEARNING_ENABLED = import.meta.env.VITE_ICARUS_LEARNING_ENABLED === 'true'
const IcarusPreparation = lazy(() => import('./features/preparation/IcarusPreparation'))
const PalaceExplorer = lazy(() => import('./features/spaces/PalaceExplorer'))
const CognitiveLibrary = lazy(() => import('./features/learning/CognitiveLibrary'))

class ScreenBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return (
      <section className="card" role="alert">
        <h2>No se pudo mostrar esta pantalla</h2>
        <p>Recarga la aplicación para volver a intentar.</p>
        <button type="button" className="button" onClick={() => window.location.reload()}>Recargar</button>
      </section>
    )
    return this.props.children
  }
}

function SolarLogo() {
  const [failed, setFailed] = useState(false)
  if (!failed) return <img className="brand-logo" src="/solmedieval1.png" alt="" onError={() => setFailed(true)} />
  return (
    <svg className="brand-logo" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="32" cy="32" r="15" /><circle cx="32" cy="32" r="11" />
        {Array.from({ length: 12 }, (_, i) => <path key={i} d="M32 3 29 12 35 12Z" transform={`rotate(${i * 30} 32 32)`} />)}
        <path d="M26 35Q32 40 38 35M25 28h4m6 0h4" />
      </g>
    </svg>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('memorizador-solar-theme')
      return THEMES.includes(saved) ? saved : 'medieval'
    } catch { return 'medieval' }
  })
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  const [authError, setAuthError] = useState('')
  const [selectedTextId, setSelectedTextId] = useState(null)
  const [session, setSession] = useState(null)
  const [preparationOpen, setPreparationOpen] = useState(false)
  const [spacesOpen, setSpacesOpen] = useState(false)
  const [learningOpen, setLearningOpen] = useState(false)
  const [learningSession, setLearningSession] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  useEffect(() => {
    try { localStorage.setItem('memorizador-solar-theme', theme) } catch { /* Tema conservado durante esta sesión. */ }
  }, [theme])

  useEffect(() => {
    if (!auth) return undefined
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setAuthLoading(false)
      setAuthError('')
      setSelectedTextId(null)
      setSession(null)
      setPreparationOpen(false)
      setSpacesOpen(false)
      setLearningOpen(false)
      setLearningSession(false)
      setLogoutError('')
    }, (error) => {
      setAuthError(errorMessage(error))
      setAuthLoading(false)
    })
  }, [])

  async function logout() {
    if (!auth || logoutLoading) return
    setLogoutLoading(true)
    setLogoutError('')
    try { await signOut(auth) } catch (error) { setLogoutError(errorMessage(error)) }
    finally { setLogoutLoading(false) }
  }

  function startStudy(chunks) {
    const validChunks = normalizeChunks(chunks)
    if (selectedTextId && validChunks.length) setSession({ textId: selectedTextId, chunks: validChunks })
  }

  return (
    <div className="app-container" data-theme={theme}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand"><SolarLogo /><div><h1>Memorizador Solar</h1><p className="brand-subtitle">Método Ícaro · Textos y poesía</p></div></div>
          <div className="header-controls">
            <div className="theme-control"><label htmlFor="theme">Tema</label>
              <select id="theme" value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="medieval">Medieval</option><option value="light">Claro</option><option value="dark">Oscuro</option>
              </select>
            </div>
            {user && PREPARATION_ENABLED && <button className="button button-secondary" type="button" disabled={Boolean(session) || learningSession || preparationOpen} onClick={() => { setPreparationOpen(true); setSpacesOpen(false); setLearningOpen(false) }}>Preparar Ícaro</button>}
            {user && (SPACES_ENABLED || LEARNING_ENABLED) && <button className="button button-secondary" type="button" disabled={Boolean(session) || learningSession || spacesOpen} onClick={() => { setSpacesOpen(true); setPreparationOpen(false); setLearningOpen(false) }}>Palacios Ícaro</button>}
            {user && LEARNING_ENABLED && <button className="button button-secondary" type="button" disabled={Boolean(session) || learningOpen} onClick={() => { setLearningOpen(true); setPreparationOpen(false); setSpacesOpen(false) }}>Aprender con Ícaro</button>}
            {user && <button className="button button-secondary" type="button" disabled={logoutLoading} onClick={logout}>{logoutLoading ? 'Saliendo…' : 'Cerrar sesión'}</button>}
          </div>
        </div>
      </header>
      <main id="main-content" className="page" tabIndex={-1}>
        {logoutError && <p className="notice notice-error" role="alert">{logoutError}</p>}
        <ScreenBoundary key={`${user?.uid ?? 'guest'}-${selectedTextId ?? 'library'}-${Boolean(session)}-${preparationOpen}-${spacesOpen}-${learningOpen}`}>
          {configurationError ? (
            <section className="card configuration-card" role="alert"><h2>Configura Firebase para comenzar</h2><p>{configurationError}</p><p>Usa la configuración de la aplicación web en Firebase y las variables descritas en <code>.env.example</code>.</p></section>
          ) : authLoading ? (
            <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Comprobando sesión…</div>
          ) : authError ? (
            <section className="card" role="alert"><p>{authError}</p><button className="button" type="button" onClick={() => window.location.reload()}>Reintentar</button></section>
          ) : !user ? <Auth /> : preparationOpen && PREPARATION_ENABLED ? (
            <Suspense fallback={<p className="loading" role="status">Abriendo el archivo…</p>}><IcarusPreparation user={user} onBack={() => setPreparationOpen(false)} /></Suspense>
          ) : learningOpen && LEARNING_ENABLED ? (
            <Suspense fallback={<p className="loading" role="status">Abriendo el Taller…</p>}><CognitiveLibrary user={user} onBack={() => setLearningOpen(false)} onBuildSpaces={() => { setLearningOpen(false); setSpacesOpen(true) }} onSessionChange={setLearningSession} /></Suspense>
          ) : spacesOpen && (SPACES_ENABLED || LEARNING_ENABLED) ? (
            <Suspense fallback={<p className="loading" role="status">Entrando en el palacio…</p>}><PalaceExplorer user={user} onBack={() => setSpacesOpen(false)} /></Suspense>
          ) : session ? (
            <StudyFlow key={session.textId} user={user} textId={session.textId} chunks={session.chunks} onFinish={() => setSession(null)} onCancel={() => setSession(null)} />
          ) : selectedTextId ? (
            <TextDetail key={selectedTextId} user={user} textId={selectedTextId} onBack={() => setSelectedTextId(null)} onStartStudy={startStudy} />
          ) : <Dashboard user={user} onOpenText={setSelectedTextId} />}
        </ScreenBoundary>
      </main>
    </div>
  )
}
