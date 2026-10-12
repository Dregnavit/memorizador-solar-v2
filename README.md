# Memorizador Solar

Aplicación web de repetición espaciada para prosa y poesía: React 18.3.1, Vite y Firebase 10.14.1 modular (Authentication y Firestore). Todos los componentes están escritos en JavaScript y JSX. Los temas medieval, claro y oscuro se conservan en el navegador.

La evolución al Método Ícaro ya incorpora contratos versionados, preparación y simulación segura del legado y palacios/macros/loci persistentes. Funciona con Firebase Spark, sin Cloud Functions. El Taller y el repaso escalonado son los siguientes hitos; el estudio clásico permanece disponible. Consulta el [diagnóstico y plan](docs/architecture/icarus-roadmap.md), la [decisión Spark](docs/architecture/ADR-spark.md) y la [guía de fundamentos](docs/phase-1-foundations.md).

## Desarrollo

Requiere Node.js 22.12 o superior. Ejecuta `npm ci` y `npm run dev`. `npm run build` genera `dist`, `npm run preview` permite comprobar esa compilación, `npm run lint` revisa el código y `npm test` ejecuta las pruebas del algoritmo.

La configuración Firebase aportada se aplica localmente en `.env.local`, que está ignorado por Git. Para otro checkout, copia `.env.example` a `.env.local` y completa los valores de la aplicación web de tu proyecto. Son obligatorias VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID y VITE_FIREBASE_APP_ID. Reinicia Vite después de cambiar variables. La configuración web de Firebase es pública por diseño; las reglas de Firestore controlan el acceso a los datos. No se necesitan credenciales de servicio en el frontend.

Coloca la fuente original `CloisterBlack.ttf` en `public/fonts/CloisterBlack.ttf` o en `public/CloisterBlack.ttf`. Si la fuente no está disponible, los encabezados utilizan Georgia. El encabezado carga `/solmedieval1.png` y tiene un emblema SVG integrado como alternativa. Puedes añadir tu logo original en `public/solmedieval1.png`.

## Firebase y Vercel

1. En Firebase activa Email/Password en Authentication y crea Firestore.
2. Sustituye las reglas del modo prueba por el archivo `firestore.rules`. Las cuentas conservan acceso a sus textos/progreso clásicos; la jerarquía Ícaro usa reglas específicas de propiedad, versiones e historial. La biblioteca clásica no requiere índices compuestos; los espacios necesitan los dos declarados en `firestore.indexes.json`.
3. Para publicar reglas e índices desde tu máquina autenticada: `npx firebase-tools@15.33.0 deploy --only firestore --project memorizador-solar-v2-52668`. También puedes copiar las reglas en el editor de Firebase y crear los índices declarados. Espera a que estén listos antes de activar espacios.
4. En Vercel importa el repositorio, selecciona Vite, usa `npm run build` como build command y `dist` como output directory. Añade las variables VITE_FIREBASE de tu configuración web para Production y Preview. VITE_USE_FIREBASE_EMULATORS debe ser false o estar ausente. Vite incorpora estas variables en la compilación; vuelve a desplegar después de cambiarlas.
5. Añade los dominios que uses a los dominios autorizados de Authentication. Comprueba registro, login y acceso de dos cuentas distintas tras el despliegue.

No se ha desplegado esta aplicación ni modificado la base de datos real durante su desarrollo.

## Datos y comportamiento

Los documentos se guardan en texts y el progreso en texts/{textId}/progress/{chunkId}. Los fragmentos nuevos se consideran pendientes. Repetir deja el repaso pendiente de inmediato; las otras calificaciones calculan días enteros con las fórmulas Ícaro especificadas. La tarjeta avanza solo después de confirmar el writeBatch. Un error conserva la tarjeta para reintentar. La eliminación limpia el progreso por lotes antes de borrar el documento principal.

El formulario admite títulos de hasta 120 caracteres, textos de hasta 60.000 caracteres y 1.000 fragmentos. Estos límites mantienen el documento por debajo del límite de tamaño de Firestore. La sesión de autenticación utiliza la persistencia del SDK y cada pestaña recibe actualizaciones de texto/progreso mediante onSnapshot.

## Pruebas de integración locales

Usa un proyecto demo independiente, `demo-memorizador-solar`. Con Java 21 instalado, `npx firebase-tools@15.33.0 emulators:start --only auth,firestore --project demo-memorizador-solar` utiliza firebase.json y las reglas de este repositorio. Inicia otra instancia de Vite en el puerto 5180 con VITE_USE_FIREBASE_EMULATORS=true y configuración web de demo; nunca uses el proyecto real en estas pruebas. La aplicación solo permite conectarse a emuladores en modo desarrollo.

`tests/e2e.mjs` comprueba en Chromium registro, login, temas, fragmentación, tarjetas, atajos, las cuatro calificaciones, persistencia, pendientes, aislamiento entre cuentas, eliminación del progreso y layout móvil. Playwright está declarado; requiere Chromium y la aplicación demo en 127.0.0.1:5180 (o E2E_BASE_URL local), con emuladores en 9099 y 8080. Activa los dos flags Ícaro y ejecuta `E2E_REQUIRE_PREPARATION=true E2E_REQUIRE_SPACES=true npm run test:e2e` para incluir fundamentos y espacios. `npm run test:rules` comprueba las reglas y transacciones en el emulador Firestore; ejecútalo antes, nunca simultáneamente con E2E. Los tests no acceden al proyecto Firebase real.
