# ADR: Firebase Spark y frontera de confianza

Estado: aceptado por instrucción expresa del propietario (Firestore `us-central1`, plan Spark, sin Cloud Functions).

## Decisión

Conservar React 18, Vite y Firebase v10 modular. Usar Authentication y Firestore desde el cliente, sin Cloud Functions, Admin SDK, claves de servicio ni servicios que requieran Blaze. Firestore no necesita una configuración regional adicional en el SDK web; el proyecto determina su ubicación.

El Blueprint recomienda Functions para `commitEncoding` y `submitReview` y su ADR 007 reserva el scheduler al servidor. Esa recomendación se adapta deliberadamente a la restricción gratuita del usuario. No se afirma que una aplicación cliente proporcione la misma frontera de confianza.

## Garantías verificables

En la etapa espacial, reglas específicas autorizan creación y archivado/restauración. Cada macro requiere un palacio activo y cada locus una macro del mismo palacio. Toda mutación conserva la versión anterior exacta en `revisions/vN`. Un cambio de hijo exige el cambio correspondiente del contador, la versión y `lastMutation` del padre en la misma transacción. Los historiales no se actualizan ni eliminan. Los padres con hijos activos y los loci ocupados no se archivan. La ocupación solo se permite junto con la publicación completa del Taller; no se permite liberar un locus automáticamente.

Las transacciones cliente leen antes de escribir, comprueban propiedad y versiones y usan un ID de intención estable junto a `creationRequestHash`. Ante un permiso denegado durante creación se reintenta como máximo tres veces adicionales, únicamente si una lectura nueva del padre confirma cambio de versión. Una denegación sin cambio de versión se propaga; no se evita la regla ni se reintenta indefinidamente. El archivado con una versión obsoleta exige revisión del usuario.

El Taller y el repaso ya implementan ocupación/encoding/tarjetas con referencias recíprocas mediante `getAfter`, así como tarjeta y evento atómicos con versión e ID de petición. Las reglas restringen campos, estados, topes según ayudas declaradas, consentimiento y timestamps. No se habilitan escrituras generales del propietario como sustituto de esos protocolos. Se verificó el argumento enlazado con tres tarjetas frente a los límites de expresiones/accesos; cualquier ampliación de la transacción requiere comprobarlos de nuevo.

## Límites aceptados

Un navegador controlado por su propietario puede falsear su intento, las pistas que usó o el estado FSRS calculado. Las reglas pueden proteger consistencia estructural y limitar fechas/valores, pero no ejecutar una biblioteca FSRS completa ni comprobar comprensión semántica. Los offsets UTF-16 y hashes se verifican en el dominio cliente; las reglas comprueban referencias y rangos, sin recalcular el texto seleccionado ni SHA-256. No se presentarán los datos como evaluación inviolable, garantía científica individual o competición fiable.

El proyecto de producción sigue en modo prueba según el usuario: estas garantías requieren publicar las reglas e índices del repositorio. No se publican ni se accede a datos reales como parte de las pruebas locales. El flag de interfaz no sustituye a las reglas.

`settings/profile` continúa siendo de solo lectura en estas etapas. Ninguna pantalla activa un bloqueo del legado. Las pruebas siembran perfiles con reglas deshabilitadas únicamente en el proyecto demo. El protocolo de bloqueo y migración segura compatible con Spark deberá implementarse y probarse explícitamente antes de usarlo con datos reales.
