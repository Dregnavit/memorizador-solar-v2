import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import handler from '../api/manuscripts.js'
import { serverFirebase } from '../server/firebase.js'

const url = process.env.E2E_BASE_URL || 'http://127.0.0.1:5181'
assert.equal(new URL(url).hostname, '127.0.0.1'); assert.equal(new URL(url).protocol, 'http:')
process.env.FIREBASE_ADMIN_PROJECT_ID = 'demo-memorizador-solar'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.SOLAR_ADMIN_DELETION_ENABLED = 'true'
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const part of req) { body += part; if (body.length > 8000) throw new Error('Petición demasiado grande') }
    req.body = JSON.parse(body || '{}'); res.status = (status) => { res.statusCode = status; return res }; res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res }
    await handler(req, res)
  } catch { res.statusCode = 500; res.end('{}') }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const serverUrl = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
const context = await browser.newContext(); const page = await context.newPage(); const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await context.route('**/api/manuscripts', async (route) => {
  const request = route.request()
  const response = await fetch(serverUrl, { method: 'POST', headers: { Authorization: request.headers().authorization, 'Content-Type': 'application/json' }, body: request.postData() })
  await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
})
const original = 'El río sigue.\nLa rueda gira.\nLa brisa llega.'
let sourceId, programId, uid
async function stats() {
  const { db } = serverFirebase(); const result = {}
  for (const kind of ['sources', 'units', 'literalPrograms', 'literalCards', 'literalAttempts', 'literalHints']) result[kind] = (await db.collection('users').doc(uid).collection(kind).get()).docs.map((doc) => ({ ...doc.data(), id: doc.id }))
  return result
}
async function hide() { await page.getByRole('button', { name: 'Ocultar texto y comenzar intento', exact: true }).click() }
async function answer(text) { await page.getByLabel('Escribe el texto de memoria', { exact: true }).fill(text); await page.getByRole('button', { name: 'Comparar mi intento', exact: true }).click(); await page.getByRole('heading', { name: 'Tu primer intento', exact: true }).waitFor() }
async function grade(name) { await page.getByRole('button', { name, exact: true }).click(); await page.getByText('Primer intento y agenda guardados.', { exact: false }).waitFor() }
async function finish() { await page.getByRole('button', { name: 'Finalizar recorrido', exact: true }).click(); await page.getByRole('heading', { name: 'Memorización Literal', exact: true }).waitFor() }
try {
  await page.goto(url)
  assert.deepEqual(await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return [auth.app.options.projectId, auth.emulatorConfig?.host] }), ['demo-memorizador-solar', '127.0.0.1'])
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico', { exact: true }).fill(`literal-${Date.now()}@example.test`)
  await page.getByLabel('Contraseña', { exact: true }).fill('Neutral-Example-123!')
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Palabras que permanecen', exact: true }).waitFor()
  uid = await page.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.uid)
  await page.getByRole('button', { name: 'Estudiar', exact: true }).click()
  await page.getByRole('button', { name: '+ Nuevo manuscrito', exact: true }).click()
  await page.getByLabel('Objetivo de aprendizaje', { exact: true }).selectOption('combined')
  await page.getByLabel('Idioma (etiqueta BCP 47; und si no lo conoces)', { exact: true }).fill('es')
  await page.getByLabel('Edición o versión textual', { exact: true }).fill('Prueba neutral')
  await page.getByLabel('Título del manuscrito', { exact: true }).fill('Prueba de continuidad')
  await page.getByLabel('Manuscrito original íntegro', { exact: true }).fill(original)
  await page.getByRole('button', { name: 'Guardar manuscrito', exact: true }).click()
  await page.getByRole('heading', { name: 'Preparar Memorización Literal', exact: true }).waitFor()
  await page.getByLabel('Espacios y saltos', { exact: true }).selectOption('collapse')
  await page.getByRole('button', { name: 'Confirmar cortes y preparar recorrido literal', exact: true }).click()
  await page.getByRole('heading', { name: 'Memorización Literal', exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  for (const theme of ['dark', 'light', 'medieval']) {
    await page.getByLabel('Tema', { exact: true }).selectOption(theme)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true)
  }
  await page.screenshot({ path: '/workspace/scratch/literal-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  const initial = await stats(); sourceId = initial.sources[0].id; programId = initial.literalPrograms[0].id
  assert.equal(initial.units.length, 3); assert.equal(initial.literalCards.length, 0)
  assert.ok(initial.units.every((unit) => unit.primaryConceptId === null))
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('segments')
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click()
  await hide(); assert.equal(await page.locator('blockquote').count(), 0)
  await answer('El río sigue.'); await grade('Bueno'); await page.getByRole('button', { name: 'Continuar al siguiente ejercicio', exact: true }).click()
  await hide(); await answer('La gira.'); assert.equal(await page.getByRole('button', { name: 'Fácil', exact: true }).isDisabled(), true)
  await page.getByText('Omisión', { exact: true }).waitFor(); await grade('Repetir')
  await page.getByText('Practicar de nuevo los errores sin alterar el primer resultado', { exact: true }).click()
  await page.getByLabel('Nuevo intento de reparación', { exact: true }).fill('La rueda gira.')
  await page.getByRole('button', { name: 'Comprobar reparación', exact: true }).click()
  const beforeRepairAdvance = await stats(); assert.equal(beforeRepairAdvance.literalAttempts.length, 2)
  await page.getByRole('button', { name: 'Continuar al siguiente ejercicio', exact: true }).click()
  await hide(); await page.getByLabel('Escribe el texto de memoria', { exact: true }).fill('La brisa')
  await page.getByRole('button', { name: 'Solicitar pista tras intentarlo', exact: true }).click()
  await page.getByText('Pista registrada 1/3', { exact: true }).waitFor()
  await answer('La brisa llega.'); assert.equal(await page.getByRole('button', { name: 'Fácil', exact: true }).isDisabled(), true)
  await grade('Bueno'); await finish()
  // Accumulation is a real persisted sequence, independent from its segment cards.
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('accumulative')
  await page.getByLabel('Máximo de ejercicios de la sesión', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click()
  for (const [i, text] of ['El río sigue.', 'La rueda gira.', 'El río sigue.\nLa rueda gira.'].entries()) {
    await hide(); await answer(text); await grade('Bueno')
    if (i < 2) await page.getByRole('button', { name: 'Continuar al siguiente ejercicio', exact: true }).click()
    else await finish()
  }
  assert.equal((await stats()).literalCards.filter((card) => card.scope === 'sequence').length, 1)
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('segments')
  await page.getByLabel('Desde segmento', { exact: true }).fill('3')
  await page.getByLabel('Máximo de ejercicios de la sesión', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click()
  await page.getByText('Segmentos 3–3.', { exact: false }).waitFor(); await hide(); await answer('La brisa llega.'); await grade('Bueno'); await finish()
  await page.getByLabel('Desde segmento', { exact: true }).fill('1')
  await page.evaluate(async () => {
    const { db, auth } = await import('/src/firebase.js'); const { createSpace } = await import('/src/data/firestore/spacesRepository.js'); const uid = auth.currentUser.uid
    await createSpace(db, uid, { kind: 'palace', name: 'Edificio de prueba', cue: '', ordinal: 0 }, 'literal-palace')
    await createSpace(db, uid, { kind: 'macro', palaceId: 'literal-palace', name: 'Sala de prueba', cue: 'Sala cuadrada', ordinal: 0 }, 'literal-macro')
    await createSpace(db, uid, { kind: 'locus', palaceId: 'literal-palace', macroId: 'literal-macro', name: 'Umbral de prueba', cue: 'Arco liso', ordinal: 0, sensoryCues: [] }, 'literal-locus')
  })
  await page.getByText('Asociar opcionalmente los segmentos seleccionados a un locus', { exact: true }).click()
  await page.getByLabel('Palacio', { exact: true }).selectOption('literal-palace')
  await page.getByLabel('Macro-estación', { exact: true }).selectOption('literal-macro')
  await page.getByLabel('Locus', { exact: true }).selectOption('literal-locus')
  await page.getByLabel('Imagen opcional para inicio, orden o transición', { exact: true }).fill('Una rueda de papel indica el inicio.')
  await page.getByRole('button', { name: 'Guardar asociación de segmentos 1–3', exact: true }).click()
  await page.getByText('Asociación guardada. El locus quedó ocupado para este grupo.', { exact: true }).waitFor()
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('transitions'); await page.getByLabel('Máximo de ejercicios de la sesión', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click(); await hide(); await answer('El río sigue.\nLa rueda gira.'); await grade('Bueno'); await finish()
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('whole')
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click(); await hide(); await answer(original); await grade('Bueno'); await finish()
  const afterWhole = await stats()
  assert.equal(afterWhole.literalCards.filter((card) => card.scope === 'whole').length, 1)
  assert.equal(afterWhole.literalCards.filter((card) => card.scope === 'transition').length, 1)
  assert.equal(afterWhole.literalHints.length, 1)
  assert.ok(afterWhole.literalAttempts.every((event) => !('attemptText' in event)))
  await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click()
  await page.getByLabel('Modalidad de recuperación', { exact: true }).selectOption('oral')
  await hide(); await page.getByRole('button', { name: 'He terminado mi recitación', exact: true }).click()
  await page.getByLabel('Comprobé cada palabra y el orden; mi recitación previa fue correcta', { exact: true }).check()
  assert.equal(await page.getByRole('button', { name: 'Fácil', exact: true }).isDisabled(), true); await grade('Bueno'); await finish()
  assert.ok((await stats()).literalAttempts.some((event) => event.verification === 'manual' && event.rawExact === false && event.lexicalSimilarity === null))
  await page.reload(); await page.getByRole('button', { name: 'Estudiar', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir manuscrito Prueba de continuidad', exact: true }).click()
  await page.getByRole('button', { name: /Aprendizaje Combinado · 3 segmentos/ }).click()
  await page.getByLabel('Ejercicio', { exact: true }).selectOption('whole'); await page.getByRole('button', { name: 'Comenzar recorrido', exact: true }).click(); await hide()
  const beforeArchive = (await stats()).literalCards
  const other = await context.newPage(); await other.goto(url)
  await other.evaluate(async (id) => { const { db, auth } = await import('/src/firebase.js'); const { setSourceArchived } = await import('/src/data/firestore/sourceLifecycleRepository.js'); while (!auth.currentUser) await new Promise((resolve) => setTimeout(resolve, 20)); await setSourceArchived(db, auth.currentUser.uid, id, true, crypto.randomUUID()) }, sourceId)
  await page.getByText(/La sesión se ha detenido|Manuscrito archivado/).first().waitFor()
  assert.equal(await page.getByRole('button', { name: 'Comparar mi intento', exact: true }).count(), 0)
  const archived = await stats(); assert.deepEqual(archived.literalCards, beforeArchive)
  await page.getByRole('button', { name: 'Volver al archivo', exact: true }).click()
  await page.getByRole('button', { name: 'Restaurar manuscrito', exact: true }).click()
  await page.getByRole('heading', { name: 'Preparar Memorización Literal', exact: true }).waitFor()
  assert.deepEqual((await stats()).literalCards, archived.literalCards)
  await page.getByRole('button', { name: 'Archivar manuscrito', exact: true }).click()
  assert.equal((await fetch(serverUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', sourceId }) })).status, 401)
  const otherContext = await browser.newContext(); const outsider = await otherContext.newPage()
  await outsider.goto(url); await outsider.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await outsider.getByLabel('Correo electrónico', { exact: true }).fill(`other-literal-${Date.now()}@example.test`)
  await outsider.getByLabel('Contraseña', { exact: true }).fill('Other-Neutral-123!')
  await outsider.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await outsider.getByRole('heading', { name: 'Palabras que permanecen', exact: true }).waitFor()
  const otherToken = await outsider.evaluate(async () => (await import('/src/firebase.js')).auth.currentUser.getIdToken())
  assert.equal((await fetch(serverUrl, { method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', sourceId }) })).status, 404)
  await otherContext.close()
  await page.getByRole('button', { name: 'Eliminar definitivamente', exact: true }).click()
  await page.getByRole('heading', { name: 'Revisar eliminación definitiva', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Confirmar eliminación irreversible', exact: true }).isDisabled(), true)
  await page.getByLabel('Para confirmar, escribe el título exacto: Prueba de continuidad', { exact: true }).fill('Prueba de continuidad')
  await page.getByRole('button', { name: 'Confirmar eliminación irreversible', exact: true }).click()
  await page.getByText(/Manuscrito eliminado definitivamente\./).first().waitFor()
  const final = await stats()
  for (const kind of ['sources', 'units', 'literalPrograms', 'literalCards', 'literalAttempts', 'literalHints']) assert.equal(final[kind].length, 0, kind)
  assert.deepEqual(errors, [])
  console.log(`Literal E2E OK: preparación, Unicode, corrección, pistas, acumulación, inicio intermedio, locus opcional, transición, examen, oral manual, persistencia, archivado entre pestañas y borrado autenticado; cuenta demo ${uid.slice(0, 5)}; programa ${programId.slice(-6)}`)
} catch (error) { await page.screenshot({ path: '/workspace/scratch/literal-e2e-failure.png', fullPage: true }).catch(() => {}); console.error(await page.locator('[role="alert"]').allTextContents()); throw error }
finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); const { getApps, deleteApp } = await import('firebase-admin/app'); await Promise.all(getApps().map(deleteApp)) }
