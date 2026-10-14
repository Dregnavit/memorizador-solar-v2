# Fundamentos del estudio: operación y límites de la entrega

## Activación

El modo clásico sigue siendo la experiencia predeterminada. `VITE_ICARUS_PREPARATION_ENABLED=true` muestra la preparación; `VITE_ICARUS_SPACES_ENABLED=true` muestra los palacios; `VITE_ICARUS_LEARNING_ENABLED=true` habilita la biblioteca, Taller y repaso. Reinicia Vite tras cambiar variables; en Vercel hay que recompilar. Antes de activar espacios o aprendizaje en producción, publica tanto `firestore.rules` como `firestore.indexes.json` y espera a que los índices estén listos. Trabajan con la cuenta autenticada.

La preparación es de solo lectura en Firebase. Exporta el inventario propio y su progreso, conserva campos adicionales y tipos nativos mediante un formato etiquetado y verifica manifiesto y SHA-256. El hash detecta alteración accidental o diferencias respecto del manifiesto; no es una firma que pruebe quién creó un archivo. Un archivo de otra cuenta o con hashes incoherentes se rechaza.

La captura limita explícitamente volumen y tamaño, falla sin truncar y etiqueta `uncoordinated`: cambios de otra pestaña durante la captura pueden producir un inventario no consistente. No debe usarse como autorización para aplicar una migración real. Los archivos descargados contienen texto y progreso personales; guárdalos en un lugar privado.

## Ensayo y recuperación locales

`npm run icarus:simulate` usa exclusivamente `tests/fixtures/legacy-v1.json`. La simulación restaura documentos en memoria, genera IDs deterministas para fuentes/unidades y enlaces a los IDs originales, aplica el plan dos veces y comprueba conservación exacta y ausencia de duplicados. No crea conceptos, encodings ni tarjetas. El progreso clásico conserva su algoritmo; no se transforma en FSRS.

La CLI `scripts/icarus-migrate.mjs` incluye `backup`, `verify`, `plan`, `restore`, `simulate` y `apply-local`. Consulta sus argumentos con `node scripts/icarus-migrate.mjs --help`. `apply-local` guarda el estado de un almacén de memoria en un archivo, nunca escribe a Firestore. Los respaldos y simulaciones están ignorados por Git. La herramienta no sobrescribe un archivo diferente. Las pruebas del motor verifican interrupción y reanudación con el mismo plan/checkpoint; la CLI todavía no carga un almacén parcial desde disco. No existe un comando para restaurar o migrar la base real en esta entrega.

## Espacios

En «Palacios de memoria», crea un palacio y selecciónalo; crea una macro-estación y selecciónala; añade sus loci con anclaje, orden y señales sensoriales opcionales. El orden admite empates resueltos por ID. Los nombres y anclajes se mantienen estables; la edición y reasignación se añadirán con protocolos propios más adelante.

Archivar conserva todos los documentos y sus IDs. Archiva primero los hijos activos; «Mostrar archivados» permite restaurar las estaciones empezando por sus padres. Un locus ocupado no se libera automáticamente. Los loci nuevos permanecen libres hasta la publicación atómica del Taller.

Se consultan 40 estaciones por página, con navegación anterior/siguiente y suscripciones desmontables. El filtro de archivados se aplica a la página visible; sigue navegando si una página no tiene estaciones activas. Las transacciones requieren conexión y muestran errores de versión o permisos sin declarar éxito.

Colecciones espaciales: `users/{uid}/palaces`, `macroStations`, `microStations`, con historial `revisions/vN`. La [guía cognitiva](phase-1-cognitive.md) describe las colecciones y flujos ya implementados de fuentes, unidades, conceptos, aristas, encodings, tarjetas y eventos.

## Verificación

`npm test`, `npm run lint` y `npm run build` no necesitan escribir a Firebase. `npm run test:rules` exige el emulador Firestore local en 8080 y **borra solo el proyecto demo** entre casos. No ejecutes esa suite en paralelo con E2E sobre el mismo proyecto.

Para E2E inicia Auth (9099), Firestore (8080) y Vite con un proyecto `demo-memorizador-solar`, ambos flags activos y `VITE_USE_FIREBASE_EMULATORS=true`. Ejecuta `E2E_REQUIRE_PREPARATION=true E2E_REQUIRE_SPACES=true npm run test:e2e`. Si Vite usa otro puerto local, añade `E2E_BASE_URL=http://127.0.0.1:PUERTO`. El test verifica el proyecto y la conexión Auth demo antes de registrar cuentas. Playwright está declarado en el lockfile; instala Chromium con `npx playwright install chromium` o usa `PLAYWRIGHT_CHROMIUM_EXECUTABLE` para un navegador local.

La suite comprueba fragmentación y programación clásicas, auth, temas, aislamiento, respaldo y rechazo de archivos ajenos/alterados, simulación, creación espacial, archivado/restauración, persistencia, paginación y móvil. Las pruebas de reglas ejercitan contención, idempotencia, historiales exactos, huérfanos, cruces entre palacios, contador falseado, ocupación no autorizada y rechazo de acceso ajeno.

El emulador no demuestra que los índices compuestos estén construidos en producción ni publica las reglas. La fuente y el logo originales se integraron desde GitHub. Permanece un aviso de tamaño del paquete principal.

## Continuación

La biblioteca versionada, el Taller de ocho pasos y el repaso escalonado con FSRS independiente ya están implementados y se describen en la [guía del MVP cognitivo](phase-1-cognitive.md). La migración real, los atrios y las extensiones avanzadas continúan pendientes.

La evolución posterior incorpora archivado y recorrido literal independiente; consulta la [guía actual de Memorizador Solar](learning-and-lifecycle.md) y sus requisitos de activación. Este documento conserva el alcance de la entrega histórica.
