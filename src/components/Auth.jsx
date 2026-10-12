import { useRef, useState } from 'react'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase'
import { errorMessage, safeString } from '../lib'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)
  const registering = mode === 'register'

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || !auth) return
    const normalizedEmail = safeString(email).trim()
    if (!normalizedEmail || !safeString(password).length) {
      setError('Completa el correo y la contraseña.')
      return
    }
    submitting.current = true
    setLoading(true)
    setError('')
    try {
      const operation = registering ? createUserWithEmailAndPassword : signInWithEmailAndPassword
      await operation(auth, normalizedEmail, password)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { submitting.current = false; setLoading(false) }
  }

  function toggle() {
    setMode(registering ? 'login' : 'register')
    setPassword('')
    setError('')
  }

  return (
    <section className="card auth-card" aria-labelledby="auth-title">
      <p className="eyebrow">Una palabra cada día</p>
      <h2 id="auth-title">{registering ? 'Crear cuenta' : 'Iniciar sesión'}</h2>
      <p className="muted">Guarda tus textos y cultiva la memoria con repasos espaciados.</p>
      <form onSubmit={submit}>
        <fieldset disabled={loading}>
          <legend className="sr-only">Datos de acceso</legend>
          <div className="field"><label htmlFor="auth-email">Correo electrónico</label><input id="auth-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="field"><label htmlFor="auth-password">Contraseña</label><input id="auth-password" type="password" required minLength={registering ? 6 : undefined} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={registering ? 'password-help' : undefined} />{registering && <p id="password-help" className="field-help">Usa al menos 6 caracteres y respeta la política de tu proyecto Firebase.</p>}</div>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <button className="button button-block" type="submit">{loading ? 'Conectando…' : registering ? 'Crear cuenta' : 'Iniciar sesión'}</button>
        </fieldset>
      </form>
      <div className="auth-toggle"><span className="muted">{registering ? '¿Ya tienes cuenta?' : '¿Es tu primera visita?'}</span><button className="text-link" type="button" disabled={loading} onClick={toggle}>{registering ? 'Iniciar sesión' : 'Crear cuenta'}</button></div>
    </section>
  )
}
