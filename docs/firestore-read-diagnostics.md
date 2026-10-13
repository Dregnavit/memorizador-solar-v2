# Lecturas privadas de Ícaro: diagnóstico y despliegue

Las lecturas se realizan en la base `(default)` del proyecto de la aplicación web, siempre bajo `users/{auth.uid}`. Auth y Firestore usan la misma instancia de Firebase. No se utilizan consultas `collectionGroup`, ni excepciones por cuenta, palacio o manuscrito.

## Consultas e índices

`src/data/firestore/privateQueries.js` centraliza las consultas. Conservan orden global, desempate por ID y paginación por cursor: 40 documentos visibles y uno adicional para detectar la siguiente página.

| Colección bajo `users/{uid}` | Filtro | Orden | Índice compuesto |
| --- | --- | --- | --- |
| `palaces` | Ninguno | `createdAt`, ID | No; campo único predeterminado |
| `macroStations` | `palaceId == palacio elegido` | `ordinal`, ID | `palaceId ASC, ordinal ASC` |
| `microStations` | `macroId == macro elegida` | `ordinal`, ID | `macroId ASC, ordinal ASC` |
| `sources`, `concepts` | Ninguno | `createdAt`, ID | No; campo único predeterminado |
| `units` | `sourceId == manuscrito elegido` | `ordinal`, ID | `sourceId ASC, ordinal ASC` |
| `cards` de una unidad | `unitId == unidad elegida` | `target`, ID | `unitId ASC, target ASC` |
| `cards` del archivo | `lifecycle == active` | `dueAt`, ID | `lifecycle ASC, dueAt ASC` |

Los cinco índices de `firestore.indexes.json` usan ámbito **Collection / COLLECTION**, no Collection group. Firestore añade `__name__ ASC` al índice cuando se omite: coincide con el desempate solicitado. `dueAt` y `createdAt` son Timestamp; los ordinales son números. No se cambian campos ni documentos existentes.

Las consultas y el manifiesto del repositorio son compatibles. El patrón «palacios disponibles pero macros y repasos fallan» es compatible con índices compuestos ausentes o todavía en construcción, pero **no demuestra esa causa**. Los callbacks anteriores descartaban el código original. La consulta de índices reales desde este entorno fue rechazada por Firebase CLI por falta de autenticación utilizable. Tampoco se dispone aquí de las variables de Vercel ni de una URL de producción: no se ha validado el backend desplegado.

La configuración web local corresponde al proyecto previsto y tiene los emuladores desactivados. Una petición de solo lectura al endpoint público de configuración de Authentication devolvió HTTP 200: el número de proyecto corresponde al configurado y el dominio de Auth está autorizado. El bundle de producción generado contiene el proyecto, dominio y appId configurados, sin los identificadores demo de las pruebas. Esto valida la configuración local y su compilación; no permite inspeccionar las reglas/índices remotos ni las variables efectivamente usadas por Vercel.

## Estados y diagnóstico en la aplicación

Los hooks comparten `usePrivateRead` y conservan estas situaciones:

- `loading`: todavía no hay respuesta.
- `unconfirmed`: respuesta de caché o escritura pendiente; el servidor todavía no confirmó el resultado. No se publica un contador de pendientes.
- `ready`: respuesta válida del servidor; una lista vacía puede mostrar cero pendientes.
- `error`: error de Firebase con código, mensaje original, proyecto, colección y consulta. No se presenta como cero ni como un espacio vacío.
- `invalid`: hay documentos que no cumplen el contrato o cuyo ID/propietario son inconsistentes. Se muestran como lectura incompleta, sin reescribirlos ni calcular pendientes sobre ese resultado.
- `idle`: falta sesión o selección superior; todavía no se ha realizado una consulta.

«Detalle de Firebase» permite inspeccionar el error original, incluido el enlace de creación de índice si el SDK lo proporciona. Los datos no se envían a telemetría ni se imprimen en consola. El diagnóstico no añade títulos, contenido, identificadores de usuario ni valores de filtros. Un reintento crea un listener nuevo; los callbacks de listeners cancelados se ignoran. Un fallo no borra la selección del palacio o macro.

| Código original | Acción según el mensaje original |
| --- | --- |
| `failed-precondition` con referencia a un índice | Comprobar el índice requerido, su ámbito y estado READY. Crear/publicar si falta; esperar si está construyéndose. |
| `failed-precondition` por otra condición | Inspeccionar el mensaje: no atribuir automáticamente cualquier precondición a índices. |
| `permission-denied` | Comparar reglas realmente publicadas, proyecto y sesión. El propietario debe poder leer sus rutas privadas. No abrir lecturas entre cuentas. |
| `unauthenticated` | Restablecer sesión; revisar configuración de Auth. |
| `unavailable` | Comprobar conectividad y reintentar. La caché no demuestra que la colección esté vacía. |
| `resource-exhausted` | Comprobar cuota de Firestore/Spark. |

## Qué aplicar en Firebase y Vercel

Modificar el repositorio o compilar Vite **no publica reglas ni índices**. No se han desplegado cambios ni modificado datos reales en esta corrección. Las reglas existentes ya permiten las lecturas privadas del propietario y rechazan otras cuentas; no se han relajado ni modificado.

1. En Firebase Console, selecciona `memorizador-solar-v2-52668`, Firestore `(default)`, Índices. Comprueba los cinco índices de la tabla, ámbito Collection y estado **Enabled (READY)**. Tener el índice declarado o una operación de despliegue completada no significa que haya terminado de construirse.
2. Si faltan índices, desde una máquina autenticada ejecuta:

   ```sh
   npx firebase-tools@15.33.0 login
   npx firebase-tools@15.33.0 deploy --only firestore:indexes --project memorizador-solar-v2-52668 --non-interactive
   ```

   No uses `--force`: deben conservarse índices ajenos al manifiesto. El comando es para índices y no migra ni elimina documentos. Como alternativa, créalos con los campos y ámbito de la tabla en Firebase Console. Espera a READY antes de comprobar las lecturas.
3. Si el diagnóstico es `permission-denied`, compara las reglas publicadas con `firestore.rules`. Solo si faltan las reglas privadas verificadas, revisa y publica ese archivo:

   ```sh
   npx firebase-tools@15.33.0 deploy --only firestore:rules --project memorizador-solar-v2-52668
   ```

   No sustituyas las reglas por modo prueba ni por `allow read, write: if true`.
4. En Vercel, comprueba **Production y Preview**: `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_API_KEY` y `VITE_FIREBASE_APP_ID` deben corresponder a la misma aplicación web del proyecto indicado. `VITE_USE_FIREBASE_EMULATORS` debe estar ausente o ser `false`. Recompila y redespliega después de cambiar variables o código: Vite las incorpora durante el build. La inicialización impide reutilizar silenciosamente una aplicación con una configuración distinta o usar emuladores en producción.
5. Con dos cuentas distintas, comprueba palacios, macros, loci, unidades y repasos. Si todavía falla, el detalle de la aplicación proporcionará el código y mensaje necesarios para identificar la causa del despliegue; no uses contenido privado de documentos para solucionarla.

No se necesitan Cloud Functions, Blaze, credenciales administrativas en el navegador ni una migración de datos.

## Regresiones

`npm run check:firestore` y `npm run build` comprueban que cada consulta compuesta esté cubierta por el manifiesto realmente referenciado por `firebase.json`. Es una verificación **local**, no una comprobación de índices publicados.

`npm test` prueba clasificación y conservación de errores, caché frente a vacío remoto, datos inválidos, paginación y callbacks cancelados. `npm run test:rules` ejecuta las consultas reales bajo las reglas con dos cuentas y anónimo; prueba filtros de distintos padres y 85 documentos por colección con empates de orden.

Con Auth/Firestore emulados en `demo-memorizador-solar`, Vite local y los flags Ícaro activos, `npm run test:e2e:firestore` provoca denegaciones reales de lectura **solo en las reglas del emulador**, verifica el código visible, reintento, conservación de selección, dos palacios/loci, cero únicamente tras respuesta válida y caché sin falso cero. Restaura las reglas del emulador al terminar. Ejecútalo secuencialmente después de `test:rules`, sin simultanearlo con otros E2E.

El emulador no exige índices compuestos. Sus pruebas de lectura correctas no prueban que los índices de producción existan: por eso se añade la comprobación del manifiesto y el paso explícito de verificación de READY en Firebase.

## Archivos de esta corrección

| Archivos | Cambio |
| --- | --- |
| `src/data/firestore/privateQueries.js` (nuevo) | Contratos de consultas privadas, filtros permitidos, orden y cursores; definición de los índices requeridos. |
| `src/data/firestore/readState.js` (nuevo) | Estados de lectura, errores originales, validación de snapshots y protección ante callbacks cancelados. |
| `src/data/hooks/usePrivateRead.js` (nuevo), `useSpaces.js`, `useLearningData.js` | Listener paginado compartido, reintentos, limpieza y aislamiento al cambiar cuenta o padre. |
| `src/components/ReadNotice.jsx` (nuevo), `src/App.css` | Diagnóstico accesible con código/mensaje original y adaptación de enlaces largos a pantallas pequeñas. |
| `src/features/spaces/PalaceExplorer.jsx` | Estados de lectura compartidos; conservar selección ante fallo; vacío solo cuando corresponde. |
| `src/features/learning/CognitiveLibrary.jsx` | No calcular ni mostrar pendientes ante error, caché o datos incompletos; aplicar la misma condición a objetivos de una unidad. |
| `src/features/learning/EncodingWorkshop.jsx` | Diagnóstico/reintento también en la selección espacial del Taller y controles de navegación coherentes con el estado de lectura. |
| `src/firebase.js`, `src/firebaseConfiguration.js` (nuevo) | Validar configuración y evitar reutilizar silenciosamente otra aplicación Firebase o una conexión de emuladores incompatible. |
| `scripts/check-firestore.mjs` (nuevo), `package.json` | Comprobar consultas/índices locales durante el build y registrar la nueva regresión E2E. |
| `tests/unit/firestore-reads.test.js`, `tests/unit/firebase-configuration.test.js` (nuevos) | Regresiones de errores, caché, validación, cancelación, paginación, índices y configuración. |
| `tests/integration/rules.test.js` | Consultas afectadas bajo reglas reales del emulador, aislamiento de cuentas/padres y paginación con 85 registros. |
| `tests/e2e-firestore-reads.mjs` (nuevo) | Denegaciones reales de permisos, reintentos y estados visibles en Chromium. |
| `README.md`, `docs/firestore-read-diagnostics.md` (nuevo) | Contrato de índices, límites de la auditoría remota y pasos seguros para verificar/publicar la configuración en Firebase. |

No se modificaron `firestore.rules` ni `firestore.indexes.json`: las reglas y los cinco índices del repositorio ya corresponden a las consultas verificadas. Tampoco se cambiaron dependencias ni el lockfile.
