# Evolución implementada: compatibilidad, seguridad y operación

Esta implementación desarrolla las entregas 2–4 del [plan aprobado](solar-evolution-plan.md). La nomenclatura interna histórica se conserva. No se ejecutan migraciones ni borrados reales como parte del despliegue. El frontend y el servicio se verifican primero contra `demo-memorizador-solar`.

## Contratos compatibles

- `sources` mantiene v1. Solo admite una transición lifecycle/version acoplada a `sourceEvents` y un recibo idempotente `sourceOperations`. Una petición repetida después de restaurar no vuelve a archivar.
- `sources/{id}/revisions/r1` admite lectores explícitos v1 y v2. V2 añade idioma, edición y learningGoal. Original, hash y revisión permanecen inmutables. Las v1 siguen válidas, sin backfill.
- `units` conserva su contrato v1: status significa preparación **conceptual**. Un programa literal puede estar preparado aunque status siga needs_concept. No se fabrican conceptos para satisfacer ese contrato.
- `literalPrograms` v2 vincula fuente/revisión/hash, rangos ordenados, unitIds, objetivo literal/combined y perfil de comparación versionado. Se cubre exactamente el original. La lectura comprueba unidades, fuente, revisión y offsets; las preparaciones son inmutables.
- `literalMemberships` identifica unidades compartidas con el recorrido literal. Las nuevas publicaciones de su Taller crean concepto/explicación; no duplican el objetivo verbal. Las publicaciones v1 existentes se conservan, incluidas sus tarjetas verbatim.
- `literalExercises`, `literalCards` y `literalAttempts` v2 mantienen el binding explícito y agendas independientes por ámbito. Reutilizan `ts-fsrs@5.4.2` y codec 2 sin convertir ni reiniciar agendas anteriores. Los eventos son inmutables e idempotentes y contienen snapshots de scheduler antes/después, perfil, modalidad y evidencia de ayuda. La respuesta es opt-in; el diff no se almacena automáticamente.
- `literalHints` registra el uso antes de mostrar contenido. `literalBindings` asocia rangos consecutivos a un locus, con escena opcional.
- Los loci v1 siguen admitidos. La variante v2 usa `activeBinding: {kind: literal, id}` y `activeEncodingId: null` durante ocupación literal; no se sobrecarga el identificador conceptual. Ambos recorridos compiten por el mismo state free, versión y contador. Los snapshots previos exactos se conservan.
- `control/maintenance` y `deletionJobs` son de escritura exclusiva del servidor. El propietario puede consultar su estado, pero no alterar barreras, trabajos ni manifiestos. Los manifiestos no son legibles desde el cliente.

No se incrementa una constante global para reinterpretar datos viejos. No se cambia ningún ID, colección existente, bandera anterior, gate conceptual o estado FSRS publicado.

## Archivado y disponibilidad

`sourceLifecycleRepository` implementa transiciones y recibos en una transacción. `useAvailableCards` resuelve fuentes por unitId para tarjetas v1, incluso si la fuente no pertenece a la página visible; las tarjetas literales tienen sourceId explícito. Una lectura de padre fallida no se convierte en vacío. `ActiveStudyGuard` escucha fuentes y mantenimiento; hasta confirmar servidor bloquea el estudio. Las transacciones y Rules vuelven a comprobar disponibilidad al escribir.

Las guardas de publicación conceptual están en la transición obligatoria de unidad. La codificación prueba versión anterior/posterior; los hijos requieren el nuevo encoding. Esta autorización recíproca mantiene los controles dentro de los límites de evaluaciones y lecturas de Rules, incluida la publicación enlazada con tres tarjetas. Los autorreportes y el scheduler cliente siguen teniendo los límites de confianza descritos en ADR-spark; Rules no ejecuta un algoritmo FSRS ni certifica una recitación.

## Servicio de borrado

`api/manuscripts.js` solo acepta POST y Bearer ID token, valida revocación, issuer, audience y UID. El proyecto administrativo debe coincidir con el VITE_FIREBASE_PROJECT_ID si está disponible. El UID no se toma del cuerpo. No admite rutas, listas de documentos ni conteos enviados por el navegador. No se registran textos, intentos ni credenciales.

`server/manuscripts/service.js` enumera el grafo completo y subcolecciones mediante el SDK oficial, incluyendo padres sin documento. Pagina lecturas de 200, limita a 20.000 documentos por cuenta/inventario y valida contratos reconocidos. Un esquema, colección o propietario incompatible bloquea; no se elimina un resultado parcial. El inventario identifica referencias externas por ambos extremos y evidencias; una fuente archivada también bloquea.

La confirmación compara una huella con updateTimes completos, incluidos nanosegundos. Se adquiere primero una barrera persistente por cuenta y se recalcula el inventario antes de borrar. Las escrituras cliente no pueden introducir referencias durante mantenimiento; solo el servicio administrativo usa Admin, restringido al namespace derivado del token. No debe ejecutarse simultáneamente otro escritor administrativo que ignore esa barrera.

La preparación del manifiesto también es reanudable: existe un trabajo preparing desde la adquisición del bloqueo. Una concesión vencida habilita otro trabajador, pero nunca desbloquea el grafo. Cada página contiene hasta 40 tareas. Liberación de locus, snapshots, borrados y checkpoint se confirman atómicamente. Los reintentos validan concesión/cursor; una ruta de locus cambiada detiene la operación y no libera el nuevo anclaje.

Los documentos hijos se eliminan antes de sus raíces. Las páginas completadas prueban cierre del manifiesto bajo la barrera; la finalización comprueba contadores, ausencia de fuente y subcolecciones antes de desbloquear. La finalización también puede reanudarse si termina el proceso después del último checkpoint. Se limpian manifiestos al terminar y se conserva un recibo operativo sin texto. Los snapshots históricos espaciales permanecen como historia, sin constituir ocupaciones activas.

Antes del primer checkpoint destructivo puede cancelarse. Después no hay rollback ficticio: se reanuda. Una ocupación o versión cambiada requiere revisar el conflicto, no forzar el borrado. Las colecciones reservadas sin contrato implementado requieren revisión si contienen documentos.

## Activación de producción

1. Publicar primero este frontend con `VITE_SOLAR_EVOLUTION_ENABLED=false` o ausente. Se mantienen lectores compatibles y las funciones anteriores; no se realizan las nuevas escrituras ni lecturas de colecciones que las reglas antiguas desconocen. La nomenclatura y el Modo Guiado están disponibles.
2. Tras la autorización administrativa pertinente, desplegar **solo las reglas** verificadas: `npx firebase-tools@15.33.0 deploy --only firestore:rules --project memorizador-solar-v2-52668`. Esto no se ejecutó durante desarrollo. No hay índices compuestos nuevos: las consultas literales filtran un solo campo; siguen siendo necesarios los cinco índices previos, cuyo estado remoto no se deduce de Git.
3. Configurar `VITE_SOLAR_EVOLUTION_ENABLED=true` para el entorno autorizado y recompilar en Vercel. Mantener `VITE_ICARUS_LEARNING_ENABLED=true`; los otros flags anteriores conservan sus nombres. Nunca activar emuladores en Production.
4. El servicio administrativo queda cerrado con 503 mientras `SOLAR_ADMIN_DELETION_ENABLED` no sea true. Para habilitarlo, configurar exclusivamente en servidor `FIREBASE_ADMIN_PROJECT_ID` igual al proyecto web y una identidad válida por ADC o `FIREBASE_ADMIN_CREDENTIALS` JSON de cuenta de servicio. **Nunca** usar prefijo VITE para una credencial privada. La API key web no sirve como credencial Admin.
5. La cuenta de servicio necesita acceso de datos equivalente a `roles/datastore.user` y comprobación de revocación de Auth (`firebaseauth.users.get`), preferiblemente mediante un rol específico sin gestión de usuarios, IAM, reglas o índices. El SDK Admin omite Rules: su alcance real es de proyecto, y el código impone propiedad por token. No asignar Owner/Editor. Configurar secretos solo en Vercel y rotarlos según política operativa.
6. Habilitar la eliminación real solo después de revisar identidad, permisos, Rules y retención. Esta es una activación administrativa específica, no una consecuencia automática de un commit del frontend. Verificar primero con cuentas de prueba autorizadas; no usar información privada real como fixture.

`vercel.json` limita cada llamada a 60 s. Cada POST procesa un checkpoint; el navegador presenta progreso y puede reanudar. Inventarios que superen el límite o los recursos del proveedor se rechazan y precisan una operación administrativa independiente, nunca un borrado parcial presentado como completo.

## Verificación reproducible

Usar Auth 9099 y Firestore 8080 con el proyecto demo. `npm run test:rules` ejecuta secuencialmente suites que limpian esa base. La credencial ficticia del emulador se genera efímeramente y solo es admitida para el proyecto demo y host local; jamás se acepta en Production.

Iniciar Vite demo en 5181 con los tres flags existentes y `VITE_SOLAR_EVOLUTION_ENABLED=true`. Ejecutar secuencialmente `test:e2e:literal`, `test:e2e:cognitive`, `test:e2e:guidance`, `test:e2e` con los flags de preparación/espacios y `test:e2e:firestore`. El E2E literal levanta un servidor HTTP local que ejecuta el handler real, verifica el ID token del emulador y ejerce el borrado desde la interfaz: no simula una respuesta de éxito.

Ejecutar también `npm test`, `npm run lint`, `npm run build` y una compilación con la nueva bandera activa. El servidor Admin no debe aparecer en dist. No ejecutar Rules/E2E simultáneamente. La compilación conserva el aviso previo del chunk principal superior a 500 kB.

## Resultado de verificación local

En esta implementación pasaron 60 pruebas unitarias, 35 de integración/Rules y las cinco suites E2E (literal, conceptual, orientación, clásico con preparación/espacios y diagnóstico de Firestore). Pasaron lint, build normal y build con la nueva bandera activa, además de la cobertura local de los cinco índices. La suite literal incluye pantalla de 375 px en los tres temas y el endpoint HTTP real con tokens Auth demo; otra cuenta recibe 404 sobre el ID ajeno y un anónimo recibe 401.

Las regresiones incluyen cancelación de preparación con concesión vencida, dos trabajadores, reanudación del cierre, intento de recrear conceptos durante un borrado parcial, referencias dentro del gate de una codificación y conceptos/aristas históricos sin encodingId. La suite conceptual mantiene el intento durante desconexión y confirma reintento sin duplicados. El SDK Admin y las variables de credenciales no aparecen en el bundle web. Los datos y el estado administrativo de producción no se modificaron en estas verificaciones.
