# Memorizador Solar

Aplicación web de repetición espaciada para prosa y poesía: React 18.3.1, Vite y Firebase 10.14.1 modular (Authentication y Firestore). Todos los componentes están escritos en JavaScript y JSX. Los temas medieval, claro y oscuro se conservan en el navegador.

El recorrido de estudio incorpora contratos versionados, preparación segura del legado, palacios/macros/loci, Taller obligatorio y repaso escalonado con FSRS por objetivo. Funciona con Firebase Spark, sin Cloud Functions; el estudio clásico permanece disponible. Consulta el [diagnóstico y plan](docs/architecture/icarus-roadmap.md), la [decisión Spark](docs/architecture/ADR-spark.md), la [guía de fundamentos](docs/phase-1-foundations.md) y la [guía del Taller y repaso](docs/phase-1-cognitive.md).

La [Entrega 1: Modo Guiado](docs/guided-mode.md) incorpora introducción interactiva, ayuda por campo y modos Guiado/Normal persistentes por cuenta en el navegador. Usa «Nivel de ayuda» y «Cómo funciona» en el encabezado. No requiere variables, reglas, índices ni dependencias adicionales: basta desplegar el frontend. El archivado, la eliminación segura y el recorrido literal del [plan de evolución](docs/architecture/solar-evolution-plan.md) están implementados; consulta la [guía de uso](docs/learning-and-lifecycle.md) y el [protocolo de activación](docs/architecture/evolution-implementation.md). Las nuevas escrituras requieren publicar las reglas y activar su bandera, y el borrado administrativo requiere configurar el servidor.

Las lecturas privadas distinguen errores, caché y respuestas confirmadas: una consulta fallida no muestra cero pendientes. Consulta el [diagnóstico de Firestore y pasos de despliegue](docs/firestore-read-diagnostics.md). `npm run check:firestore` valida consultas e índices del repositorio y forma parte del build; los índices reales deben comprobarse y publicarse por separado en Firebase.

## Desarrollo

Requiere Node.js 22.12 o superior. Ejecuta `npm ci` y `npm run dev`. `npm run build` genera `dist`, `npm run preview` permite comprobar esa compilación, `npm run lint` revisa el código y `npm test` ejecuta las pruebas del algoritmo.

La configuración Firebase aportada se aplica localmente en `.env.local`, que está ignorado por Git. Para otro checkout, copia `.env.example` a `.env.local` y completa los valores de la aplicación web de tu proyecto. Son obligatorias VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID y VITE_FIREBASE_APP_ID. Reinicia Vite después de cambiar variables. La configuración web de Firebase es pública por diseño; las reglas de Firestore controlan el acceso a los datos. No se necesitan credenciales de servicio en el frontend.

El repositorio incluye la fuente original en `public/CloisterBlack.ttf` y el logo en `public/solmedieval1.png`, integrados desde GitHub. Los encabezados usan la fuente gótica y conservan Georgia como alternativa; el logo conserva un emblema SVG ante un fallo de carga.

## Firebase y Vercel

1. En Firebase activa Email/Password en Authentication y crea Firestore.
2. Sustituye las reglas del modo prueba por el archivo `firestore.rules`. Las cuentas conservan acceso a sus textos/progreso clásicos; El estudio usa reglas específicas de propiedad, versiones, relaciones e historial. La biblioteca clásica no requiere índices compuestos; publica los cinco índices declarados en `firestore.indexes.json` para espacios, unidades y tarjetas.
3. Para publicar reglas e índices desde tu máquina autenticada: `npx firebase-tools@15.33.0 deploy --only firestore --project memorizador-solar-v2-52668`. También puedes copiar las reglas en el editor de Firebase y crear los índices declarados. Espera a que estén listos antes de activar espacios.
4. En Vercel importa el repositorio, selecciona Vite, usa `npm run build` como build command y `dist` como output directory. Añade las variables VITE_FIREBASE de tu configuración web para Production y Preview. VITE_USE_FIREBASE_EMULATORS debe ser false o estar ausente. Vite incorpora estas variables en la compilación; vuelve a desplegar después de cambiarlas.
5. Añade los dominios que uses a los dominios autorizados de Authentication. Comprueba registro, login y acceso de dos cuentas distintas tras el despliegue.

Las pruebas y los borrados de desarrollo usan únicamente emuladores y datos ficticios. El estado de producción no se deduce de los archivos del repositorio.

Para activar el nuevo flujo, añade `VITE_ICARUS_LEARNING_ENABLED=true` en Vite/Vercel tras publicar reglas e índices, y recompila. «Estudiar» permite guardar una fuente, revisar cortes, completar el Taller y repasar concepto, explicación o recitación. `VITE_ICARUS_SPACES_ENABLED=true` y `VITE_ICARUS_PREPARATION_ENABLED=true` controlan los accesos independientes a espacios y simulación. La migración real sigue deshabilitada.

## Datos y comportamiento

En el modo clásico, los documentos se guardan en texts y el progreso en texts/{textId}/progress/{chunkId}. Los fragmentos nuevos se consideran pendientes. Repetir deja el repaso pendiente de inmediato; las otras calificaciones calculan días enteros con las fórmulas originales, conservadas como legacy-v1. La tarjeta avanza solo después de confirmar el writeBatch. Un error conserva la tarjeta para reintentar. La eliminación clásica limpia el progreso por lotes antes de borrar el documento principal.

El estudio usa colecciones privadas bajo users/{uid}, fuente y selección inmutables, codificación espacial y una agenda FSRS por objetivo. `ts-fsrs@5.4.2` conserva el estado completo y sus parámetros. Las respuestas del examen permanecen en memoria; las del repaso solo se guardan con consentimiento por tarjeta. Las reglas validan consistencia y límites, sin certificar comprensión ni ejecutar FSRS en un servidor.

El formulario admite títulos de hasta 120 caracteres, textos de hasta 60.000 caracteres y 1.000 fragmentos. Estos límites mantienen el documento por debajo del límite de tamaño de Firestore. La sesión de autenticación utiliza la persistencia del SDK y cada pestaña recibe actualizaciones de texto/progreso mediante onSnapshot.

## Pruebas de integración locales

Usa un proyecto demo independiente, `demo-memorizador-solar`. Con Java 21 instalado, `npx firebase-tools@15.33.0 emulators:start --only auth,firestore --project demo-memorizador-solar` utiliza firebase.json y las reglas de este repositorio. Inicia otra instancia de Vite en el puerto 5180 con VITE_USE_FIREBASE_EMULATORS=true y configuración web de demo; nunca uses el proyecto real en estas pruebas. La aplicación solo permite conectarse a emuladores en modo desarrollo.

`tests/e2e.mjs` comprueba en Chromium registro, login, temas, fragmentación, tarjetas, atajos, las cuatro calificaciones, persistencia, pendientes, aislamiento entre cuentas, eliminación del progreso y layout móvil. Playwright está declarado; requiere Chromium y la aplicación demo en 127.0.0.1:5180 (o E2E_BASE_URL local), con emuladores en 9099 y 8080. Activa los flags de preparación y espacios y ejecuta `E2E_REQUIRE_PREPARATION=true E2E_REQUIRE_SPACES=true npm run test:e2e` para incluir fundamentos y espacios. `npm run test:rules` comprueba las reglas y transacciones en el emulador Firestore; ejecútalo antes, nunca simultáneamente con E2E. Los tests no acceden al proyecto Firebase real.

Activa también `VITE_ICARUS_LEARNING_ENABLED=true` en Vite demo y ejecuta `E2E_BASE_URL=http://127.0.0.1:5181 npm run test:e2e:cognitive` (ajusta el puerto). Comprueba el Taller completo/reanudable, examen, prosa y poesía dual, intentos antes de revelar, pistas y topes, desconexión/reintento sin duplicados, agendas independientes, privacidad y móvil.

`E2E_BASE_URL=http://127.0.0.1:5181 npm run test:e2e:firestore` comprueba errores reales de permisos en el emulador, diagnóstico, reintentos, jerarquías de distintos palacios y ausencia de falso cero ante error o caché. Restaura las reglas al finalizar; no lo ejecutes simultáneamente con los otros E2E o pruebas de reglas.

## Memorización Literal y gestión de manuscritos

Aprendizaje Conceptual, Memorización Literal y Aprendizaje Combinado comparten fuentes inmutables y unidades. El recorrido literal permite cortes revisables, comparación Unicode, pistas registradas, reparación, acumulación, transiciones, inicio intermedio y exámenes con agendas FSRS propias. La recitación oral es manual. El apoyo espacial y el audio local son opcionales. No incluye contenidos personales ni obras predeterminadas.

`VITE_SOLAR_EVOLUTION_ENABLED` queda en false por defecto para desplegar lectores antes de nuevas escrituras. Tras la publicación autorizada de las Rules, activarla en Vercel y recompilar. No hay índices compuestos nuevos. La eliminación está cerrada por defecto y solo se habilita con `SOLAR_ADMIN_DELETION_ENABLED=true` e identidad administrativa de servidor, después de revisar permisos y reglas. Nunca guardar credenciales Admin en variables VITE. Consulta [seguridad y configuración](docs/architecture/evolution-implementation.md).

`npm run test:e2e:literal` verifica el recorrido escrito, transiciones, examen, oral manual, persistencia, archivado entre pestañas y eliminación con el endpoint real autenticado contra los emuladores. Activar la nueva bandera también en Vite demo. `npm run test:rules` cubre las operaciones administrativas y sus interrupciones, propiedad, dependencias y contratos antiguos; sus archivos se ejecutan secuencialmente para no limpiar fixtures concurrentemente.
