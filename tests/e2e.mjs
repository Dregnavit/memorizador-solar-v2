import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const url = 'http://127.0.0.1:5180'
const project = 'demo-memorizador-solar'
const documents = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents/texts`
const email = `solar-${Date.now()}@example.test`
const password = 'Solar-Test-123!'
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true })
const contexts = []
const runtimeErrors = []

async function register(page, address) {
  await page.goto(url)
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
  assert.deepEqual(runtimeErrors, [])
  console.log('E2E OK: registro, login, errores de Auth, temas, prosa, poesía, 4 calificaciones, atajos, pendientes, persistencia, aislamiento, borrado y móvil.')
} finally {
  await Promise.all(contexts.map(context => context.close()))
  await browser.close()
}
