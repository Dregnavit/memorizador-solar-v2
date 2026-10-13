import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const url = process.env.E2E_BASE_URL || 'http://127.0.0.1:5181'
assert.equal(new URL(url).hostname, '127.0.0.1')
assert.equal(new URL(url).protocol, 'http:')
const project = 'demo-memorizador-solar'
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) })
const context = await browser.newContext()
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const originalProse = 'Todas las aves de este relato tienen alas. La alondra pertenece a esas aves. La alondra tiene alas.'
const originalPoem = 'El sol guarda su nombre\nen la piedra del claustro.\n\nEl tiempo pasa.'
let uid

async function documents(kind) {
  const response = await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/users/${uid}/${kind}`, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(response.status, 200)
  return (await response.json()).documents || []
}
async function station(kind, name, cue) {
  await page.getByRole('button', { name: `+ ${kind}`, exact: true }).click()
  await page.getByLabel('Nombre', { exact: true }).fill(name)
  await page.getByLabel(kind === 'palacio' ? 'Descripción del palacio' : 'Anclaje espacial', { exact: true }).fill(cue)
  await page.getByRole('button', { name: 'Guardar estación', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: `Seleccionar ${kind} ${name}`, exact: true }).click()
}
async function nextStation() { await page.getByRole('button', { name: 'Siguiente estación', exact: true }).click() }
async function manuscript(poetry = false) {
  await page.getByRole('button', { name: '+ Nuevo manuscrito Ícaro', exact: true }).click()
  await page.getByLabel('Título del manuscrito', { exact: true }).fill(poetry ? 'Poesía dual' : 'Inferencia de la alondra')
  if (poetry) await page.getByLabel('Género del manuscrito', { exact: true }).selectOption('poetry')
  await page.getByLabel('Manuscrito original íntegro', { exact: true }).fill(poetry ? originalPoem : originalProse)
  await page.getByRole('button', { name: 'Guardar manuscrito', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  if (poetry) await page.getByRole('button', { name: 'Preparar unidad 1', exact: true }).click()
  else {
    await page.getByLabel('Selecciona una unidad en el manuscrito original').focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.getByRole('button', { name: 'Preparar selección del manuscrito', exact: true }).click()
  }
  await page.getByRole('heading', { name: 'Estación 1 de 8 · Manuscrito', exact: true }).waitFor()
}
async function workshop(poetry = false) {
  await nextStation()
  await page.getByRole('alert').filter({ hasText: 'Revisa y confirma el fragmento original.' }).waitFor()
  await page.getByLabel('Revisé el corte y confirma una unidad coherente', { exact: true }).check()
  await nextStation()
  await page.getByLabel('Qué hace el autor aquí', { exact: true }).selectOption(poetry ? 'interpretation' : 'argument')
  assert.equal(await page.getByLabel('Objetivo de aprendizaje', { exact: true }).inputValue(), poetry ? 'dual' : 'conceptual')
  await nextStation()
  await page.getByLabel('Concepto con mis palabras', { exact: true }).fill(poetry ? 'El poema imagina que la luz perdura en un lugar estable.' : 'La pertenencia de la alondra a las aves del relato permite atribuirle alas.')
  if (!poetry) {
    await page.getByLabel('Premisas', { exact: true }).fill('Todas las aves de este relato tienen alas.\nLa alondra pertenece a esas aves.')
    await page.getByLabel('Conclusión', { exact: true }).fill('La alondra tiene alas.')
    await page.getByLabel('Por qué se sigue la conclusión', { exact: true }).fill('La propiedad universal se aplica al miembro del conjunto.')
    await page.getByLabel('Necesito investigar antes de codificar', { exact: true }).check()
    await nextStation()
    await page.getByRole('alert').filter({ hasText: 'Resuelve primero lo que necesitas investigar.' }).waitFor()
    await page.getByLabel('Necesito investigar antes de codificar', { exact: true }).uncheck()
  }
  await nextStation()
  await page.getByLabel('Por qué es fundacional', { exact: true }).fill('Es la primera tesis de este manuscrito en mi recorrido.')
  await nextStation()
  await page.getByLabel('Palacio para la escena', { exact: true }).selectOption({ label: 'Monasterio cognitivo' })
  await page.getByLabel('Macro-estación para la escena', { exact: true }).selectOption({ label: 'Galería cognitiva' })
  await page.getByLabel('Locus libre', { exact: true }).selectOption({ label: poetry ? 'Piedra del sol' : 'Atril de la alondra' })
  await nextStation()
  await page.getByLabel('Agente de la escena', { exact: true }).fill(poetry ? 'Un sol diminuto' : 'Una alondra')
  await page.getByLabel('Acción extraordinaria', { exact: true }).fill(poetry ? 'Graba su nombre luminoso en la piedra' : 'Recibe alas al entrar en un gran libro de aves')
  await page.getByLabel('Símbolo u objeto', { exact: true }).fill(poetry ? 'Una piedra luminosa' : 'Un libro universal de aves')
  await page.getByLabel('Rasgo distintivo', { exact: true }).fill('El anclaje canta una nota grave')
  await page.getByLabel('Qué representa cada elemento', { exact: true }).fill(poetry ? 'La piedra es el lugar estable y la luz significa permanencia.' : 'El libro contiene el conjunto y sus alas representan la propiedad universal.')
  if (!poetry) {
    await page.getByRole('button', { name: 'Guardar y salir del Taller', exact: true }).click()
    await page.getByRole('button', { name: 'Continuar Taller de esta unidad', exact: true }).click()
    await page.getByRole('heading', { name: 'Estación 6 de 8 · Imagen', exact: true }).waitFor()
    assert.equal(await page.getByLabel('Agente de la escena', { exact: true }).inputValue(), 'Una alondra')
  }
  await page.getByLabel('Ensayé mentalmente la escena en su locus', { exact: true }).check()
  await nextStation()
  await page.getByLabel('Pregunta de recuperación sin solución', { exact: true }).fill('¿Qué sentido o relación representa este lugar?')
  await page.getByLabel('Cómo distingo esta escena de las vecinas', { exact: true }).fill('Su acción y su sonido no se repiten en otra escena de la galería.')
  await page.getByLabel('Comprobé que el anclaje y la escena se distinguen', { exact: true }).check()
  await nextStation()
  assert.equal(await page.locator('blockquote.source-reading').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Publicar codificación y tarjetas', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Comprobar mi recuerdo', exact: true }).isDisabled(), true)
  await page.getByLabel('¿Qué sucede en tu escena?', { exact: true }).fill('EXAMEN_PRIVADO: evoco la acción de mi agente.')
  await page.getByLabel('¿Qué significa, con tus palabras?', { exact: true }).fill('EXAMEN_PRIVADO: recupero el significado que preparé.')
  await page.getByLabel('Justifica una relación, inferencia o ejemplo', { exact: true }).fill('EXAMEN_PRIVADO: justifico la relación entre los elementos.')
  await page.getByRole('button', { name: 'Comprobar mi recuerdo', exact: true }).click()
  await page.getByLabel('Recuperé el significado y pude justificarlo sin ver la solución', { exact: true }).check()
  await page.getByLabel('Comparé mi respuesta y no encontré un error esencial', { exact: true }).check()
  await page.getByRole('button', { name: 'Publicar codificación y tarjetas', exact: true }).click()
  await page.getByText('Taller aprobado · Codificación activa', { exact: true }).waitFor()
  assert.equal(JSON.stringify(await documents('encodingDrafts')).includes('EXAMEN_PRIVADO'), false)
}
async function recall({ target, hint = false, failed = false, wrongLiteral = false, retain = false, offline = false }) {
  await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).waitFor()
  assert.equal(await page.locator('blockquote.source-reading').count(), 0)
  if (failed) await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).click().then(() => page.getByRole('button', { name: 'No recuerdo', exact: true }).click())
  else {
    await page.getByRole('button', { name: 'Comenzar recuperación', exact: true }).click()
    const answers = target === 'verbatim' ? [wrongLiteral ? 'Una recitación imprecisa.' : 'El sol guarda su nombre\nen la piedra del claustro.'] : ['Evoco la escena de mi agente en este locus.', 'RECUERDO_PRIVADO: expreso el significado con una paráfrasis propia.', 'RECUERDO_PRIVADO: justifico una relación y un ejemplo.']
    for (let index = 0; index < answers.length; index += 1) {
      await page.locator('#recall-answer').fill(answers[index])
      if (hint && index === 0) await page.getByRole('button', { name: 'Solicitar pista tras mi intento', exact: true }).click()
      await page.getByRole('button', { name: 'Registrar intento y continuar', exact: true }).click()
    }
  }
  await page.getByRole('heading', { name: 'Contrastar con la fuente', exact: true }).waitFor()
  if (target !== 'verbatim') await page.getByLabel('Recuperé la idea central antes de revelar', { exact: true }).check()
  if (target === 'explanation') await page.getByLabel('Expliqué correctamente la relación o el ejemplo', { exact: true }).check()
  await page.getByLabel('No hubo error esencial ni confusión con otra idea', { exact: true }).check()
  await page.getByRole('button', { name: 'Continuar a la calificación', exact: true }).click()
  if (failed || wrongLiteral) {
    assert.equal(await page.getByRole('button', { name: '2 · Difícil', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: '4 · Fácil', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: '1 · Repetir', exact: true }).click()
  } else {
    if (hint) assert.equal(await page.getByRole('button', { name: '4 · Fácil', exact: true }).isDisabled(), true)
    if (retain) await page.getByLabel('Conservar mis respuestas de este repaso en mi historial privado', { exact: true }).check()
    if (offline) {
      await context.setOffline(true)
      await page.getByRole('button', { name: '3 · Bueno', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'Tu intento permanece en esta tarjeta para reintentar.' }).waitFor({ timeout: 45000 })
      await context.setOffline(false)
    }
    await page.getByRole('button', { name: '3 · Bueno', exact: true }).click()
  }
}
try {
  await page.goto(url)
  const configuration = await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return { projectId: auth?.app?.options?.projectId, host: auth?.emulatorConfig?.host, port: auth?.emulatorConfig?.port } })
  assert.deepEqual(configuration, { projectId: project, host: '127.0.0.1', port: 9099 })
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico').fill(`icarus-${Date.now()}@example.test`)
  await page.getByLabel('Contraseña', { exact: true }).fill('Icarus-Test-123!')
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Palabras que permanecen' }).waitFor()
  uid = await page.evaluate(async () => { const { auth } = await import('/src/firebase.js'); return auth.currentUser.uid })
  await page.getByRole('button', { name: 'Palacios Ícaro', exact: true }).click()
  await station('palacio', 'Monasterio cognitivo', 'Un monasterio familiar de piedra.')
  await station('macro-estación', 'Galería cognitiva', 'Galería con dos anclajes separados.')
  await station('locus', 'Atril de la alondra', 'Un atril de madera junto a la entrada.')
  await station('locus', 'Piedra del sol', 'Piedra al fondo, junto a una ventana.')
  await page.getByRole('button', { name: 'Aprender con Ícaro', exact: true }).click()
  await manuscript()
  await workshop()
  assert.equal((await documents('cards')).length, 2)
  await page.getByRole('button', { name: 'Repasar objetivos pendientes (2)', exact: true }).click()
  await recall({ target: 'concept', hint: true, offline: true })
  await recall({ target: 'explanation', failed: true })
  await page.getByText('Sesión completada. Cada objetivo conserva su propia agenda.', { exact: true }).waitFor()
  const initialEvents = await documents('reviewEvents')
  assert.equal(initialEvents.length, 2)
  assert.equal(JSON.stringify(initialEvents).includes('RECUERDO_PRIVADO'), false)
  await page.getByRole('button', { name: '← Volver al archivo Ícaro', exact: true }).click()
  await manuscript(true)
  await workshop(true)
  assert.equal((await documents('cards')).length, 5)
  await page.getByRole('button', { name: 'Repasar objetivos pendientes (3)', exact: true }).click()
  await recall({ target: 'concept' })
  await recall({ target: 'explanation', retain: true })
  await recall({ target: 'verbatim', wrongLiteral: true })
  await page.getByText('Sesión completada. Cada objetivo conserva su propia agenda.', { exact: true }).waitFor()
  const events = await documents('reviewEvents')
  assert.equal(events.length, 5)
  assert.equal(events.filter((entry) => entry.fields.responseRetention.stringValue === 'opt-in').length, 1)
  assert.equal(events.filter((entry) => entry.fields.attemptText).length, 1)
  assert.equal(events.find((entry) => entry.fields.target.stringValue === 'verbatim').fields.rating.stringValue, 'again')
  const cards = await documents('cards')
  assert.equal(cards.filter((entry) => entry.fields.version.integerValue === '2').length, 5)
  await page.setViewportSize({ width: 375, height: 812 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.reload()
  await page.getByRole('button', { name: 'Aprender con Ícaro', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir manuscrito Poesía dual', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar objetivos pendientes (0)', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Cognitivo E2E OK: ingesta corregible, Taller obligatorio y reanudable, examen antes de revelar, prosa/poesía dual, pistas, topes de nota, error offline/reintento, agendas independientes, privacidad, persistencia y móvil.')
} finally { await context.close(); await browser.close() }
