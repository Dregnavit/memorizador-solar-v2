import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { chromium } from 'playwright'
import { createSpace } from '../src/data/firestore/spacesRepository.js'

const url = process.env.E2E_BASE_URL || 'http://127.0.0.1:5181'
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(new URL(url).protocol, 'http:')
const projectId = 'demo-memorizador-solar'
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
const denial = rules.replace('allow read: if owner(uid) && collectionId in [', "allow read: if owner(uid) && !(collectionId in ['macroStations', 'cards']) && collectionId in [")
assert.notEqual(denial, rules)
let environment
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('pageerror', (failure) => errors.push(failure.message))
const installRules = async (contents) => {
  await environment?.cleanup()
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: contents } })
}

try {
  await page.goto(url)
  const config = await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    return { project: auth?.app.options.projectId, emulator: auth?.emulatorConfig?.host, port: auth?.emulatorConfig?.port }
  })
  assert.deepEqual(config, { project: projectId, emulator: '127.0.0.1', port: 9099 }, 'Esta prueba solo puede ejecutarse con Firebase demo local.')
  await installRules(rules)
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico').fill(`firestore-reads-${Date.now()}@example.test`)
  await page.getByLabel('Contraseña', { exact: true }).fill('Read-Test-123!')
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Palabras que permanecen', exact: true }).waitFor()
  const uid = await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return auth.currentUser.uid })
  const db = environment.authenticatedContext(uid).firestore()
  for (const suffix of ['a', 'b']) {
    await createSpace(db, uid, { kind: 'palace', name: `Palacio de prueba ${suffix}`, cue: 'Escenario de prueba' }, `palace-${suffix}`)
    await createSpace(db, uid, { kind: 'macro', palaceId: `palace-${suffix}`, name: `Galería ${suffix}`, cue: 'Anclaje de prueba', ordinal: 0 }, `macro-${suffix}`)
    await createSpace(db, uid, { kind: 'locus', palaceId: `palace-${suffix}`, macroId: `macro-${suffix}`, name: `Atril ${suffix}`, cue: 'Atril de prueba', ordinal: 0, sensoryCues: [] }, `locus-${suffix}`)
  }
  await installRules(denial)
  await page.getByRole('button', { name: 'Palacios Ícaro', exact: true }).click()
  await page.getByRole('button', { name: 'Seleccionar palacio Palacio de prueba a', exact: true }).click()
  const macros = page.getByRole('region', { name: 'Macro-estaciones', exact: true })
  await macros.getByRole('alert').waitFor()
  await macros.getByText('permission-denied', { exact: true }).waitFor()
  assert.equal(await macros.getByText('Este espacio todavía está por construir.', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Seleccionar palacio Palacio de prueba a', exact: true }).getAttribute('aria-pressed'), 'true')
  await installRules(rules)
  await macros.getByRole('button', { name: 'Reintentar lectura', exact: true }).click()
  await macros.getByRole('button', { name: 'Seleccionar macro-estación Galería a', exact: true }).click()
  await page.getByRole('button', { name: 'Seleccionar locus Atril a', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Seleccionar palacio Palacio de prueba b', exact: true }).click()
  await macros.getByRole('button', { name: 'Seleccionar macro-estación Galería b', exact: true }).click()
  await page.getByRole('button', { name: 'Seleccionar locus Atril b', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Seleccionar locus Atril a', exact: true }).count(), 0)

  await installRules(denial)
  await page.getByRole('button', { name: 'Aprender con Ícaro', exact: true }).click()
  const reviews = page.getByLabel('Repasos escalonados', { exact: true })
  await reviews.getByRole('alert').waitFor()
  await reviews.getByText('permission-denied', { exact: true }).waitFor()
  assert.equal(await reviews.getByText(/0 objetivos pendientes/).count(), 0)
  assert.equal(await reviews.getByRole('button', { name: /Iniciar repaso escalonado/ }).count(), 0)
  await reviews.getByText('No se ha podido determinar cuántos objetivos están pendientes.', { exact: true }).waitFor()
  await installRules(rules)
  await reviews.getByRole('button', { name: 'Reintentar lectura', exact: true }).click()
  await reviews.getByText('0 objetivos pendientes en esta página de hasta 40 tarjetas.', { exact: true }).waitFor()
  assert.equal(await reviews.getByRole('alert').count(), 0)
  assert.equal(await reviews.getByRole('button', { name: 'Iniciar repaso escalonado (0)', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '← Volver al modo clásico', exact: true }).click()
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Aprender con Ícaro', exact: true }).click()
  await reviews.getByText(/Esperando confirmación de Firestore/).waitFor()
  assert.equal(await reviews.getByText(/0 objetivos pendientes/).count(), 0)
  await context.setOffline(false)
  await reviews.getByText('0 objetivos pendientes en esta página de hasta 40 tarjetas.', { exact: true }).waitFor({ timeout: 30000 })
  assert.deepEqual(errors, [])
  console.log('Firestore E2E OK: denegaciones reales, código original visible, reintento, dos palacios y loci aislados, fallo/caché sin falso cero, vacío confirmado por servidor.')
} finally {
  await context.setOffline(false)
  await page.close()
  await context.close()
  await browser.close()
  try { await installRules(rules) } finally { await environment?.cleanup() }
}
