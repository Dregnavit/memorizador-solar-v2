import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { createLegacyBackup, verifyLegacyBackup } from '@icarus/domain/migration'
const url = process.env.E2E_BASE_URL || 'http://127.0.0.1:5180'
const targetUrl = new URL(url)
assert.equal(targetUrl.protocol, 'http:')
assert.equal(targetUrl.hostname, '127.0.0.1', 'E2E solo permite una aplicación demo local.')
const project = 'demo-memorizador-solar'
const documents = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/texts`
const email = `solar-${Date.now()}@example.test`
const password = 'Solar-Test-123!'
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
const browser = await chromium.launch({ executablePath, headless: true })
const contexts = []
const runtimeErrors = []

async function register(page, address) {
  await page.goto(url)
  const configuration = await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    return { projectId: auth?.app?.options?.projectId, emulatorHost: auth?.emulatorConfig?.host, emulatorPort: auth?.emulatorConfig?.port }
  })
  assert.deepEqual(configuration, { projectId: project, emulatorHost: '127.0.0.1', emulatorPort: 9099 }, 'E2E exige un proyecto demo y Auth local; no se crearán cuentas reales.')
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click()
  await page.getByLabel('Correo electrónico').fill(address)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).first().click()
  await page.getByRole('heading', { name: 'Palabras que permanecen' }).waitFor()
  await page.getByRole('heading', { name: 'Tu biblioteca comienza aquí' }).waitFor()
}

async function create(page, title, content, type) {
  await page.getByRole('button', { name: '+ Nuevo Texto', exact: true }).click()
  await page.getByLabel('Título', { exact: true }).fill(title)
  await page.getByLabel('Tipo de texto').selectOption(type)
  await page.getByLabel('Texto completo').fill(content)
  await page.getByRole('button', { name: 'Guardar texto', exact: true }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

try {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await register(page, email)
  await page.getByLabel('Tema', { exact: true }).selectOption('dark')
  await page.reload()
  await page.getByRole('heading', { name: 'Palabras que permanecen' }).waitFor()
  assert.equal(await page.locator('.app-container').getAttribute('data-theme'), 'dark')

  await create(page, 'Poema de prueba', 'Primer verso\n\nSegundo verso\nTercer verso', 'poesia')
  await page.getByRole('button', { name: 'Abrir Poema de prueba', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar Pendientes (3)', exact: true }).waitFor()
  assert.equal(await page.locator('.badge-due').count(), 3)
  await page.getByRole('button', { name: 'Estudiar Todo', exact: true }).click()
  await page.keyboard.press('1')
  await page.getByRole('button', { name: 'Revelar / Memorizar', exact: true }).waitFor()
  await page.keyboard.press('Space')
  await page.getByText('Primer verso', { exact: true }).waitFor()
  await page.keyboard.press('1')
  await page.getByRole('heading', { name: 'Fragmento 2 de 3' }).waitFor()
  await page.keyboard.press('Enter')
  await page.keyboard.press('2')
  await page.getByRole('heading', { name: 'Fragmento 3 de 3' }).waitFor()
  await page.getByRole('button', { name: 'Revelar / Memorizar', exact: true }).click()
  await page.getByRole('button', { name: '4: Fácil', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar Pendientes (1)', exact: true }).waitFor()
  assert.equal(await page.locator('.badge-done').count(), 2)
  await page.getByRole('button', { name: 'Repasar Pendientes (1)', exact: true }).click()
  await page.getByRole('heading', { name: 'Fragmento 1 de 1' }).waitFor()
  await page.getByRole('button', { name: 'Revelar / Memorizar', exact: true }).click()
  await page.keyboard.press('3')
  await page.getByRole('button', { name: 'Repasar Pendientes (0)', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Repasar Pendientes (0)', exact: true }).click()
  await page.getByText('No hay fragmentos pendientes. ¡Todos tus repasos están al día!', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Abrir Poema de prueba', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar Pendientes (0)', exact: true }).waitFor()

  const response = await fetch(documents, { headers: { Authorization: 'Bearer owner' } })
  assert.equal(response.status, 200)
  const data = await response.json()
  const primaryUid = await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    return auth.currentUser.uid
  })
  const poem = data.documents.find(entry => entry.fields.title.stringValue === 'Poema de prueba' && entry.fields.userId.stringValue === primaryUid)
  const textId = poem.name.split('/').at(-1)
  const progressBefore = await fetch(`${documents}/${textId}/progress`, { headers: { Authorization: 'Bearer owner' } })
  assert.equal((await progressBefore.json()).documents.length, 3)
  const invalidProgressStatus = await page.evaluate(async ({ documents, textId }) => {
    const { auth } = await import('/src/firebase.js')
    const token = await auth.currentUser.getIdToken()
    const response = await fetch(`${documents}/${textId}/progress/chunk_0`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { interval: { integerValue: '-1' }, ease: { doubleValue: 2.5 }, nextReview: { integerValue: '0' } } }),
    })
    return response.status
  }, { documents, textId })
  assert.equal(invalidProgressStatus, 403)

  const otherContext = await browser.newContext()
  contexts.push(otherContext)
  const otherPage = await otherContext.newPage()
  await register(otherPage, `other-${Date.now()}@example.test`)
  assert.equal(await otherPage.getByRole('heading', { name: 'Poema de prueba', exact: true }).count(), 0)
  const deniedStatus = await otherPage.evaluate(async ({ documents, textId }) => {
    const { auth } = await import('/src/firebase.js')
    const token = await auth.currentUser.getIdToken()
    const response = await fetch(`${documents}/${textId}`, { headers: { Authorization: `Bearer ${token}` } })
    return response.status
  }, { documents, textId })
  assert.equal(deniedStatus, 403)

  await page.getByRole('button', { name: '← Volver a la biblioteca', exact: true }).click()
  await create(page, 'Prosa de prueba', 'Uno. ¿Dos? ¡Tres!\nCuatro.', 'prosa')
  await page.getByRole('button', { name: 'Abrir Prosa de prueba', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar Pendientes (4)', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Estudiar Todo', exact: true }).click()
  await page.getByRole('button', { name: 'Volver al texto', exact: true }).click()
  await page.getByRole('button', { name: 'Repasar Pendientes (4)', exact: true }).waitFor()
  await page.getByRole('button', { name: '← Volver a la biblioteca', exact: true }).click()
  page.on('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Eliminar Poema de prueba', exact: true }).click()
  await page.getByText('Texto y progreso eliminados.', { exact: true }).waitFor()
  const progressAfter = await fetch(`${documents}/${textId}/progress`, { headers: { Authorization: 'Bearer owner' } })
  assert.equal((await progressAfter.json()).documents?.length || 0, 0)

  await page.setViewportSize({ width: 375, height: 812 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click()
  await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor()
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await page.getByText('El correo o la contraseña no son correctos.', { exact: true }).waitFor()
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click()
  await page.getByRole('heading', { name: 'Palabras que permanecen' }).waitFor()
  const preparationButton = page.getByRole('button', { name: 'Preparar archivo clásico', exact: true })
  if (process.env.E2E_REQUIRE_PREPARATION === 'true') await preparationButton.waitFor()
  if (await preparationButton.count()) {
    await preparationButton.click()
    await page.getByRole('heading', { name: 'Preparación del archivo clásico', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Capturar mi biblioteca', exact: true }).click()
    await page.getByText('Respaldo verificado. La preparación está lista para simularse localmente.', { exact: true }).waitFor()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Descargar respaldo', exact: true }).click()
    const download = await downloadPromise
    const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
    await verifyLegacyBackup(backup, primaryUid)
    assert.equal(backup.manifest.textCount, 1)
    await page.getByRole('button', { name: 'Simular preparación', exact: true }).click()
    await page.getByText('Segunda ejecución: 0 documentos duplicados.', { exact: true }).waitFor()
    const newSources = await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/users/${primaryUid}/sources`, { headers: { Authorization: 'Bearer owner' } })
    assert.ok([200, 404].includes(newSources.status))
    if (newSources.status === 200) assert.equal((await newSources.json()).documents?.length || 0, 0)
    const altered = structuredClone(backup); altered.capturedAt.seconds += 1
    await page.getByLabel('O abre un respaldo anterior').setInputFiles({ name: 'altered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(altered)) })
    await page.getByRole('alert').filter({ hasText: 'El respaldo fue alterado o está incompleto' }).waitFor()
    const foreign = await createLegacyBackup({ userId: 'foreign-user', records: [], consistency: 'fixture' })
    await page.getByLabel('O abre un respaldo anterior').setInputFiles({ name: 'foreign.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(foreign)) })
    await page.getByText('El respaldo pertenece a otra cuenta.', { exact: true }).waitFor()
    await page.getByLabel('O abre un respaldo anterior').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    await page.getByRole('button', { name: 'Simular preparación', exact: true }).waitFor()
    await page.getByRole('button', { name: '← Volver a mis textos', exact: true }).click()
    await page.getByRole('heading', { name: 'Palabras que permanecen' }).waitFor()
    console.log('Preparación E2E OK: captura de lectura, descarga, simulación, rechazo de archivo alterado/ajeno y vuelta al clásico.')
  }
  const spacesButton = page.getByRole('button', { name: 'Palacios de memoria', exact: true })
  if (process.env.E2E_REQUIRE_SPACES === 'true') await spacesButton.waitFor()
  if (await spacesButton.count()) {
    await spacesButton.click()
    await page.getByRole('heading', { name: 'Tus palacios de memoria', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '+ macro-estación', exact: true }).isDisabled(), true)
    async function createStation(kind, name, cue) {
      await page.getByRole('button', { name: `+ ${kind}`, exact: true }).click()
      await page.getByLabel('Nombre', { exact: true }).fill(name)
      await page.getByLabel(kind === 'palacio' ? 'Descripción del palacio' : 'Anclaje espacial', { exact: true }).fill(cue)
      if (kind === 'locus') await page.getByLabel('Señales sensoriales (opcionales)', { exact: true }).fill('Piedra fría\nAgua que murmura')
      await page.getByRole('button', { name: 'Guardar estación', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      const select = page.getByRole('button', { name: `Seleccionar ${kind} ${name}`, exact: true })
      await select.waitFor()
      await select.click()
    }
    await createStation('palacio', 'Monasterio de prueba', 'Un monasterio de piedra, conocido y estable.')
    await createStation('macro-estación', 'Claustro de prueba', 'Galería con arcos, al entrar a la izquierda.')
    await createStation('locus', 'Fuente de prueba', 'Fuente octogonal en el centro del claustro.')
    await page.getByText('Piedra fría · Agua que murmura', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Archivar macro-estación Claustro de prueba', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Archivar palacio Monasterio de prueba', exact: true }).isDisabled(), true)
    const originalSpaces = await page.evaluate(async ({ project }) => {
      const { auth } = await import('/src/firebase.js')
      const token = await auth.currentUser.getIdToken()
      const result = {}
      for (const kind of ['palaces', 'macroStations', 'microStations']) {
        const response = await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/users/${auth.currentUser.uid}/${kind}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!response.ok) throw new Error(`Lectura espacial fallida: ${response.status}`)
        result[kind] = ((await response.json()).documents || []).map((entry) => ({ id: entry.name.split('/').at(-1), palaceId: entry.fields.palaceId?.stringValue, macroId: entry.fields.macroId?.stringValue, activeLocusCount: Number(entry.fields.activeLocusCount?.integerValue) }))
      }
      return result
    }, { project })
    assert.equal(originalSpaces.palaces.length, 1)
    assert.equal(originalSpaces.macroStations[0].activeLocusCount, 1)
    assert.equal(originalSpaces.microStations[0].macroId, originalSpaces.macroStations[0].id)
    assert.equal(originalSpaces.microStations[0].palaceId, originalSpaces.palaces[0].id)
    await page.getByRole('button', { name: 'Archivar locus Fuente de prueba', exact: true }).click()
    await page.getByText('Estación archivada. Puedes restaurarla desde «Mostrar archivados».', { exact: true }).waitFor()
    await page.getByLabel('Mostrar archivados', { exact: true }).check()
    await page.getByRole('button', { name: 'Restaurar locus Fuente de prueba', exact: true }).click()
    await page.getByText('Estación restaurada. Su identidad y anclaje se conservan.', { exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: 'Palacios de memoria', exact: true }).click()
    await page.getByRole('button', { name: 'Seleccionar palacio Monasterio de prueba', exact: true }).click()
    await page.getByRole('button', { name: 'Seleccionar macro-estación Claustro de prueba', exact: true }).click()
    await page.getByRole('button', { name: 'Seleccionar locus Fuente de prueba', exact: true }).waitFor()
    const restoredLocusResponse = await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/users/${primaryUid}/microStations/${originalSpaces.microStations[0].id}`, { headers: { Authorization: 'Bearer owner' } })
    assert.equal(restoredLocusResponse.status, 200)
    const restoredLocus = (await restoredLocusResponse.json()).fields
    assert.equal(restoredLocus.state.stringValue, 'free')
    assert.equal(restoredLocus.version.integerValue, '3')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    // Exercise the actual hook and UI cursor, not a duplicate pagination algorithm.
    const privateRoot = `projects/${project}/databases/(default)/documents/users/${primaryUid}`
    const palaceTemplateResponse = await fetch(`http://127.0.0.1:8080/v1/${privateRoot}/palaces/${originalSpaces.palaces[0].id}`, { headers: { Authorization: 'Bearer owner' } })
    assert.equal(palaceTemplateResponse.status, 200)
    const palaceTemplate = (await palaceTemplateResponse.json()).fields
    const writes = Array.from({ length: 41 }, (_, index) => {
      const id = `pagination-${String(index).padStart(2, '0')}`
      return { update: { name: `${privateRoot}/palaces/${id}`, fields: { ...palaceTemplate, id: { stringValue: id }, title: { stringValue: `Palacio paginado ${index}` }, version: { integerValue: '1' }, activeMacroCount: { integerValue: '0' }, lastMutation: { nullValue: null }, createdAt: { timestampValue: '2030-01-01T00:00:00Z' } } } }
    })
    const seedPages = await fetch(`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents:commit`, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) })
    assert.equal(seedPages.status, 200)
    const palaceColumn = page.getByRole('region', { name: 'Palacios', exact: true })
    await palaceColumn.getByRole('button', { name: 'Siguiente', exact: true }).waitFor()
    assert.equal(await palaceColumn.locator('.space-select').count(), 40)
    await palaceColumn.getByRole('button', { name: 'Siguiente', exact: true }).click()
    await palaceColumn.getByText('Página 2', { exact: true }).waitFor()
    await palaceColumn.getByRole('button', { name: 'Seleccionar palacio Palacio paginado 39', exact: true }).waitFor()
    assert.equal(await palaceColumn.locator('.space-select').count(), 2)
    await palaceColumn.getByRole('button', { name: 'Anterior', exact: true }).click()
    await palaceColumn.getByRole('button', { name: 'Seleccionar palacio Monasterio de prueba', exact: true }).click()
    await page.getByRole('button', { name: 'Seleccionar macro-estación Claustro de prueba', exact: true }).click()
    await page.getByRole('button', { name: 'Seleccionar locus Fuente de prueba', exact: true }).waitFor()
    await otherPage.getByRole('button', { name: 'Palacios de memoria', exact: true }).click()
    await otherPage.getByRole('heading', { name: 'Tus palacios de memoria', exact: true }).waitFor()
    assert.equal(await otherPage.getByRole('button', { name: 'Seleccionar palacio Monasterio de prueba', exact: true }).count(), 0)
    await page.getByRole('button', { name: '← Volver a mis textos', exact: true }).click()
    await page.getByRole('button', { name: 'Abrir Prosa de prueba', exact: true }).click()
    await page.getByRole('button', { name: 'Repasar Pendientes (4)', exact: true }).waitFor()
    console.log('Espacios E2E OK: jerarquía, anclajes, dependencias, archivado/restauración, persistencia, paginación, aislamiento y móvil; legado conservado.')
  }
  assert.deepEqual(runtimeErrors, [])
  console.log('E2E OK: registro, login, errores de Auth, temas, prosa, poesía, 4 calificaciones, atajos, pendientes, persistencia, aislamiento, borrado y móvil.')
} finally {
  await Promise.all(contexts.map(context => context.close()))
  await browser.close()
}
