import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { getDocFromServer, getDocs, collection } from 'firebase/firestore'
import { chromium } from 'playwright'
import { emptyWorkshop } from '@icarus/domain/encoding'
import { createSource, createUnit, privateRef, publishEncoding, saveWorkshopDraft } from '../src/data/firestore/cognitiveRepository.js'
import { createSpace } from '../src/data/firestore/spacesRepository.js'
import { preferenceKey } from '../src/features/guidance/preferences.js'

const url = process.env.E2E_BASE_URL || 'http://127.0.0.1:5181'
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(new URL(url).protocol, 'http:')
const projectId = 'demo-memorizador-solar'
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const password = 'Guidance-Test-123!'
const email = `guidance-${Date.now()}@example.test`
let environment
async function register(address) {
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico', { exact: true }).fill(address)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Palabras que permanecen', exact: true }).waitFor()
}
async function next() { await page.getByRole('button', { name: 'Siguiente estación', exact: true }).click() }
async function mode(value) { await page.getByLabel('Nivel de ayuda', { exact: true }).selectOption(value) }
const topic = (name) => page.locator(`[data-help-topic="${name}"]`)
async function accessibleReferences() {
  const issues = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    const missing = [...document.querySelectorAll('[aria-describedby], [aria-labelledby]')].flatMap((node) =>
      ['aria-describedby', 'aria-labelledby'].flatMap((name) => (node.getAttribute(name) ?? '').split(/\s+/).filter((id) => id && !document.getElementById(id))))
    return { duplicates, missing }
  })
  assert.deepEqual(issues, { duplicates: [], missing: [] })
}

try {
  await page.goto(url)
  assert.deepEqual(await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return { project: auth?.app.options.projectId, host: auth?.emulatorConfig?.host, port: auth?.emulatorConfig?.port } }), { project: projectId, host: '127.0.0.1', port: 9099 })
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } })
  await register(email)
  const uid = await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return auth.currentUser.uid })
  assert.equal(await page.getByLabel('Nivel de ayuda', { exact: true }).inputValue(), 'guided')
  await page.getByRole('button', { name: 'Comenzar introducción', exact: true }).click()
  const intro = page.getByRole('dialog', { name: 'Un palacio es un escenario familiar', exact: true })
  await intro.waitFor()
  await intro.getByRole('radio', { name: 'Una casa que puedo recorrer mentalmente', exact: true }).check()
  await intro.getByRole('status').filter({ hasText: 'Así es.' }).waitFor()
  await page.getByRole('button', { name: 'Siguiente paso', exact: true }).click()
  await page.getByRole('button', { name: 'Paso anterior', exact: true }).click()
  assert.equal(await intro.getByRole('radio', { name: 'Una casa que puedo recorrer mentalmente', exact: true }).isChecked(), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Comenzar introducción', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Cómo funciona', exact: true }).click()
  for (let index = 0; index < 6; index += 1) await page.getByRole('button', { name: 'Siguiente paso', exact: true }).click()
  await page.getByRole('button', { name: 'Terminar introducción', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Cómo funciona', exact: true }).evaluate((node) => node === document.activeElement), true)
  await mode('normal')
  await page.reload()
  await page.getByLabel('Nivel de ayuda', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Nivel de ayuda', { exact: true }).inputValue(), 'normal')
  assert.equal(await page.getByRole('button', { name: 'Comenzar introducción', exact: true }).count(), 0)
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), preferenceKey(uid))
  assert.deepEqual(stored, { version: 1, mode: 'normal', introduction: 'completed' })
  await accessibleReferences()
  const otherTab = await context.newPage()
  otherTab.on('pageerror', (error) => errors.push(error.message))
  await otherTab.goto(url)
  await otherTab.getByLabel('Nivel de ayuda', { exact: true }).waitFor()
  await mode('guided')
  await otherTab.waitForFunction(() => document.querySelector('#guidance-level')?.value === 'guided')
  await otherTab.getByLabel('Nivel de ayuda', { exact: true }).selectOption('normal')
  await page.waitForFunction(() => document.querySelector('#guidance-level')?.value === 'normal')
  await otherTab.close()

  const db = environment.authenticatedContext(uid).firestore()
  await createSpace(db, uid, { kind: 'palace', name: 'Casa de la guía', cue: 'Casa familiar' }, 'guide-palace')
  await createSpace(db, uid, { kind: 'macro', palaceId: 'guide-palace', name: 'Patio de la guía', cue: 'Patio interior', ordinal: 0 }, 'guide-macro')
  for (const [id, name] of [['guide-used', 'Fuente ocupada'], ['guide-free', 'Banco libre']]) await createSpace(db, uid, { kind: 'locus', palaceId: 'guide-palace', macroId: 'guide-macro', name, cue: 'Punto concreto del patio', ordinal: 0, sensoryCues: [] }, id)
  const original = 'La semilla necesita agua. La luz ayuda al crecimiento.'
  await createSource(db, uid, { title: 'Manuscrito de la guía', kind: 'prose', originalText: original, segmentationMode: 'sentences' }, 'guide-source')
  const pendingUnit = await createUnit(db, uid, 'guide-source', { revisionId: 'r1', startOffset: 0, endOffset: original.indexOf('.') + 1, ordinal: 0 })
  const readyUnit = await createUnit(db, uid, 'guide-source', { revisionId: 'r1', startOffset: original.indexOf('La luz'), endOffset: original.length, ordinal: 1 })
  const payload = { ...emptyWorkshop(), sourceReviewed: true, proposition: 'SIGNIFICADO_PRIVADO_DE_PRUEBA', foundation: 'Inicio de esta rama', palaceId: 'guide-palace', macroId: 'guide-macro', locusId: 'guide-used', agent: 'AGENTE_PRIVADO_DE_PRUEBA', action: 'Abre un libro', symbol: 'Libro', distinctiveCue: 'Campana', mapping: 'Explica la relación de esta escena', prompt: '¿Qué relación recuperas?', distinction: 'Se distingue por la campana', mentalRehearsal: true, sceneDistinguished: true, entranceAttempted: true, entrancePassed: true, meaningConfirmed: true }
  await saveWorkshopDraft(db, uid, readyUnit, payload, 7, 0)
  await publishEncoding(db, uid, readyUnit, 1)
  const documents = async (kind) => (await getDocs(collection(db, 'users', uid, kind))).docs
  assert.equal((await documents('cards')).length, 2)

  await page.getByRole('button', { name: 'Aprender con Ícaro', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir manuscrito Manuscrito de la guía', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar Taller de esta unidad', exact: true }).click()
  await mode('guided')
  await topic('workshop.sourceReviewed').locator('summary').click()
  assert.equal(await topic('workshop.sourceReviewed').locator('dt').count(), 6)
  const reviewed = page.getByLabel('Revisé el corte y confirma una unidad coherente', { exact: true })
  assert.equal(await reviewed.isChecked(), false, 'Abrir ayuda no marca la comprobación.')
  await next()
  await page.getByRole('alert').filter({ hasText: 'Revisa y confirma el fragmento original.' }).waitFor()
  await mode('normal')
  await next()
  await page.getByRole('heading', { name: 'Estación 1 de 8 · Manuscrito', exact: true }).waitFor()
  await reviewed.check()
  await next()
  await mode('guided')
  await page.getByLabel('Objetivo de aprendizaje', { exact: true }).selectOption('literal')
  await topic('workshop.mode').getByText(/sigue siendo obligatorio completar todo el Taller/).first().waitFor()
  await page.getByLabel('Qué hace el autor aquí', { exact: true }).selectOption('argument')
  await accessibleReferences()
  await next()
  const proposition = page.getByLabel('Concepto con mis palabras', { exact: true })
  await proposition.fill('BORRADOR QUE NO DEBE CAMBIAR AL CAMBIAR LA AYUDA')
  await page.getByLabel('Premisas', { exact: true }).fill('Una razón para mi afirmación')
  await page.getByLabel('Conclusión', { exact: true }).fill('La afirmación que sostengo')
  await page.getByLabel('Por qué se sigue la conclusión', { exact: true }).fill('Explico la conexión entre ambas')
  await page.getByText('Borrador guardado', { exact: true }).waitFor()
  const beforeVersion = (await getDocFromServer(privateRef(db, uid, 'encodingDrafts', pendingUnit))).data().version
  await mode('normal')
  assert.equal(await proposition.inputValue(), 'BORRADOR QUE NO DEBE CAMBIAR AL CAMBIAR LA AYUDA')
  assert.equal(await page.getByRole('complementary', { name: 'Orientación de la estación 3', exact: true }).count(), 0)
  await page.waitForTimeout(900) // Debe superar el debounce real del borrador, sin disparar otro guardado.
  assert.equal((await getDocFromServer(privateRef(db, uid, 'encodingDrafts', pendingUnit))).data().version, beforeVersion)
  await mode('guided')
  await page.getByLabel('Necesito investigar antes de codificar', { exact: true }).check()
  await next()
  await page.getByRole('alert').filter({ hasText: 'Resuelve primero lo que necesitas investigar.' }).waitFor()
  await page.getByLabel('Necesito investigar antes de codificar', { exact: true }).uncheck()
  await next()
  await page.getByLabel('Este concepto es fundacional en mi recorrido', { exact: true }).uncheck()
  await topic('workshop.foundational').getByText(/Ahora debes elegir un concepto anterior/).waitFor()
  assert.equal(await page.getByLabel('Por qué es fundacional', { exact: true }).count(), 0)
  await next()
  await page.getByRole('alert').filter({ hasText: 'Justifica su carácter fundacional o enlaza un concepto anterior.' }).waitFor()
  await page.getByLabel('Concepto anterior', { exact: true }).selectOption(`${readyUnit}_e1_concept`)
  for (const relation of ['causes', 'implies', 'contrasts', 'defines', 'example_of', 'argument_order', 'depends_on']) {
    await page.getByLabel('Relación con el concepto anterior', { exact: true }).selectOption(relation)
    await topic('workshop.edgeType').getByText('Dirección del enlace: idea nueva → idea anterior.', { exact: true }).waitFor()
  }
  await page.getByLabel('Justificación de la relación', { exact: true }).fill('Mi nueva idea necesita la anterior para interpretarse')
  await accessibleReferences()
  await next()
  await page.getByLabel('Palacio para la escena', { exact: true }).selectOption('guide-palace')
  await page.getByLabel('Macro-estación para la escena', { exact: true }).selectOption('guide-macro')
  const occupied = page.getByLabel('Locus libre', { exact: true }).locator('option[value="guide-used"]')
  await occupied.waitFor({ state: 'attached' })
  assert.equal(await occupied.isDisabled(), true)
  assert.match(await occupied.textContent(), /ocupado/)
  await page.getByLabel('Locus libre', { exact: true }).selectOption('guide-free')
  await next()
  await topic('workshop.mapping').locator('summary').click()
  await topic('workshop.mapping').getByText(/puente entre imaginación y comprensión/).waitFor()
  await accessibleReferences()
  await page.getByRole('button', { name: 'Guardar y salir del Taller', exact: true }).click()
  assert.equal((await documents('cards')).length, 2, 'La ayuda no publica tarjetas ni completa el Taller.')

  await page.getByRole('button', { name: 'Repasar objetivos pendientes (2)', exact: true }).click()
  await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).waitFor()
  assert.ok(!(await page.locator('main').textContent()).includes('SIGNIFICADO_PRIVADO_DE_PRUEBA'))
  assert.ok(!(await page.locator('main').textContent()).includes('AGENTE_PRIVADO_DE_PRUEBA'))
  await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).click()
  await page.getByLabel('¿Qué sucede en este lugar?', { exact: true }).fill('INTENTO QUE DEBE CONSERVARSE')
  await mode('normal')
  assert.equal(await page.getByLabel('¿Qué sucede en este lugar?', { exact: true }).inputValue(), 'INTENTO QUE DEBE CONSERVARSE')
  await topic('review.hints').locator('summary').click()
  await accessibleReferences()
  assert.equal(await page.getByText('Pista H1', { exact: true }).count(), 0, 'La ayuda general no expone una pista del contenido.')
  assert.ok(!(await page.locator('main').textContent()).includes('SIGNIFICADO_PRIVADO_DE_PRUEBA'))
  await page.getByRole('button', { name: 'No recuerdo', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar a la calificación', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '4 · Fácil', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Cómo funciona', exact: true }).click()
  await page.keyboard.press('1')
  await page.waitForTimeout(200)
  assert.equal((await documents('reviewEvents')).length, 0, 'Atajos del repaso no deben actuar dentro de la introducción.')
  await page.keyboard.press('Escape')
  await topic('review.ratings').locator('summary').focus()
  await page.keyboard.press('1')
  assert.equal((await documents('reviewEvents')).length, 0)
  await page.keyboard.press('Space')
  assert.equal(await topic('review.ratings').locator('details').getAttribute('open'), '')
  await page.getByRole('button', { name: '1 · Repetir', exact: true }).click()
  await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).waitFor()
  assert.equal((await documents('reviewEvents')).length, 1)
  await page.getByRole('button', { name: 'Terminar sesión Ícaro', exact: true }).click()

  await mode('normal')
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await register(`other-guidance-${Date.now()}@example.test`)
  assert.equal(await page.getByLabel('Nivel de ayuda', { exact: true }).inputValue(), 'guided')
  await page.getByRole('button', { name: 'Saltar introducción', exact: true }).click()
  await page.reload()
  await page.getByLabel('Nivel de ayuda', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Comenzar introducción', exact: true }).count(), 0)

  await page.addInitScript(() => {
    const get = Storage.prototype.getItem; const set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) { if (key.startsWith('memorizador-solar:guidance:')) throw new Error('blocked'); return get.call(this, key) }
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('memorizador-solar:guidance:')) throw new Error('quota'); return set.call(this, key, value) }
  })
  await page.reload()
  await page.getByText(/No se puede guardar la preferencia de ayuda/).waitFor()
  await mode('normal')
  assert.equal(await page.getByLabel('Nivel de ayuda', { exact: true }).inputValue(), 'normal')
  for (const theme of ['medieval', 'light', 'dark']) {
    await page.getByLabel('Tema', { exact: true }).selectOption(theme)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.getByRole('button', { name: 'Cómo funciona', exact: true }).click()
    await accessibleReferences()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth), true)
    await page.getByRole('region', { name: 'Contenido del paso', exact: true }).evaluate((node) => { node.scrollTop = node.scrollHeight })
    for (const name of ['Salir de la introducción', 'Siguiente paso']) {
      assert.equal(await page.getByRole('button', { name, exact: true }).evaluate((node) => { const box = node.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight }), true)
    }
    await page.keyboard.press('Escape')
  }
  assert.deepEqual(errors, [])
  console.log('Guía E2E OK: introducción interactiva/salto/reapertura/foco, persistencia y cuentas separadas, almacenamiento bloqueado, seis apartados, ramas del Taller, gates intactos, borrador/intento conservados, locus ocupado, privacidad, atajos seguros, tres temas y móvil.')
} finally { await context.close(); await browser.close(); await environment?.cleanup() }
