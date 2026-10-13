import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firebaseConfigurationProblem } from '../../src/firebaseConfiguration.js'

const config = { apiKey: 'demo-local-key', projectId: 'demo-memorizador-solar', appId: 'demo-web-app', authDomain: 'demo-memorizador-solar.firebaseapp.com' }

test('configuración: producción no acepta emuladores y desarrollo usa sus variables explícitas', () => {
  assert.equal(firebaseConfigurationProblem(config, { production: true, emulators: false }), '')
  assert.equal(firebaseConfigurationProblem(config, { production: false, emulators: true }), '')
  assert.match(firebaseConfigurationProblem(config, { production: true, emulators: true }), /Desactiva VITE_USE_FIREBASE_EMULATORS/)
  assert.match(firebaseConfigurationProblem({ ...config, projectId: ' ' }, {}), /projectId/)
})

test('configuración: no reutiliza silenciosamente una aplicación de otro proyecto o Auth distinto', () => {
  assert.equal(firebaseConfigurationProblem(config, { existingOptions: { ...config } }), '')
  for (const field of ['projectId', 'appId', 'authDomain', 'apiKey']) {
    const message = firebaseConfigurationProblem(config, { existingOptions: { ...config, [field]: 'different-config' } })
    assert.match(message, /Recarga la página/)
    assert.ok(!message.includes('demo-local-key'), 'Los errores de configuración no imprimen valores de credenciales.')
  }
})
