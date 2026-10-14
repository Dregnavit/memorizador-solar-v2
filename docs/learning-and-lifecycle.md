# Memorizador Solar: estudiar y administrar manuscritos

Memorizador Solar admite textos propios de cualquier idioma y género. No contiene obras, palacios ni recorridos personales predeterminados. El archivo clásico sigue disponible con su algoritmo anterior.

## Elegir un objetivo

En **Estudiar → Nuevo manuscrito**, elige Aprendizaje Conceptual, Memorización Literal o Aprendizaje Combinado. Introduce el original íntegro, idioma y edición si los conoces. No se consulta ni sustituye la edición por una versión externa. El límite es de 60.000 caracteres UTF-16; si lo superas, se informa antes de guardar y no se trunca el manuscrito.

El recorrido conceptual conserva el Taller de Codificación, con destilación, enlaces, escena y examen de entrada. El recorrido literal funciona sin esos formularios. El combinado comparte las mismas unidades: su Taller crea objetivos de concepto y explicación; la fidelidad verbal tiene su propia preparación y agenda. Las tarjetas publicadas en versiones anteriores mantienen su forma, identidad y progreso.

La preferencia **Modo Guiado / Modo Normal**, la introducción y las ayudas siguen disponibles. Las ayudas generales nunca revelan palabras de tu manuscrito. Cada nueva sección explica propósito, operación, ejemplos, cuándo usarla y consecuencias.

## Preparar memoria verbal

1. Abre el manuscrito y revisa los cortes propuestos por oraciones, líneas/versículos, estrofas o párrafos. Puedes colocar el cursor en el original para añadir un corte, o unir segmentos en la lista. Se conservan el orden y los separadores originales. Los números no se eliminan automáticamente.
2. Configura los criterios: mayúsculas, puntuación, diacríticos y espacios. Las equivalencias i/j o u/v solo se aplican si las activas. Las formas gramaticales distintas siguen siendo distintas. Una forma Unicode compuesta y su equivalente canónico se comparan como el mismo grafema, mientras la igualdad íntegra de caracteres se informa por separado.
3. Confirma los cortes. Cada preparación identifica revisión, segmentos y criterios; volver a confirmar exactamente lo mismo reutiliza la preparación. Cambiar cortes o criterios crea una preparación independiente sin borrar las anteriores. Se admiten hasta 200 segmentos por preparación.
4. Puedes asociar un segmento o grupo consecutivo a un locus libre. La imagen es opcional. Un lugar ocupado, reservado, en descanso o archivado no puede reutilizarse. Un enlace publicado no se sustituye silenciosamente.

## Practicar

Elige segmentos, acumulación por bloques, transiciones, examen de sección o examen íntegro. Puedes comenzar desde un punto intermedio, configurar bloques de 2–20 segmentos y acotar una sesión a 1–100 ejercicios. La cola de repaso abre hasta 40 ejercicios cada vez.

**Lee → oculta → intenta → contrasta → califica → continúa.** Durante familiarización puedes pronunciar, usar ritmo o canto, o reproducir un audio local propio. El archivo de audio no se sube y no se conserva entre sesiones. No se requiere micrófono ni servicio externo.

Al escribir, el intento se conserva sin recortarlo con trim. La corrección muestra omisiones, añadidos y sustituciones con posiciones y etiquetas, además de advertencias de cambio de orden y alineaciones ambiguas. Las repeticiones pueden admitir varias alineaciones válidas. Los cambios de desinencia se muestran como cambios textuales: no existe un analizador morfológico que determine su intención.

Se informa por separado igualdad íntegra, exactitud léxica, conformidad con los criterios elegidos y similitud. Una similitud del 100 % no acredita por sí sola una respuesta perfecta. La alineación tiene un presupuesto de cuatro millones de celdas, se ejecuta en un worker y no trunca silenciosamente una obra. Si se agota, se indica comparación incompleta y se permite únicamente Repetir; usa una sección más breve para localizar los errores.

Las pistas se guardan antes de exponer su contenido: palabra inicial, comienzo y revelación completa. Las dos primeras limitan la nota a Bueno y Difícil respectivamente; revelar o responder incorrectamente limita a Repetir. Un fallo no puede calificarse Difícil como sustituto de Repetir.

Califica el **primer intento**. Después puedes reparar errores sin registrar un segundo repaso ni reemplazar el resultado inicial. Por defecto se conservan métricas y agenda; el texto del intento se guarda solo con consentimiento por intento. Las diferencias completas no se guardan por defecto.

La recitación oral exige intentar antes de mostrar el original y comprobar manualmente cada palabra. Se registra **verificación manual**, sin porcentaje automático ni declaración de perfección. Su nota máxima es Bueno. No se usa reconocimiento de voz.

## Exámenes y repaso

Cada segmento, secuencia, transición y examen tiene una agenda FSRS independiente. Un examen íntegro utiliza el original completo de su edición, con sus separadores; no reconstruye la obra uniendo fragmentos con espacios inventados. Los resultados de exámenes se consultan en su apartado y no se deducen de haber aprobado segmentos aislados.

Repetir indica error; Difícil, recuerdo conseguido con esfuerzo; Bueno, correcto razonablemente fluido; Fácil, autónomo y fluido bajo los criterios elegidos. FSRS conserva su estado completo y calcula fechas a partir del historial; no promete un calendario fijo ni certifica comprensión.

## Archivar, restaurar y eliminar

Desde la biblioteca o ficha puedes archivar un manuscrito. Desaparece del filtro Activos y de las colas ordinarias. Sus unidades, asociaciones, loci ocupados, agendas e historiales permanecen intactos. Las sesiones abiertas reciben el cambio y las operaciones de guardado comprueban la fuente activa dentro de la transacción y en Rules.

En Archivados puedes restaurar sin reiniciar fechas: los vencimientos conservados pueden aparecer pendientes inmediatamente. La biblioteca conceptual sigue paginando 40 registros; un filtro sin coincidencias en una página no declara vacía toda la cuenta.

La eliminación definitiva se ofrece desde Archivados y requiere el servicio administrativo configurado. Primero muestra un inventario completo y navegable, dependencias externas y loci afectados. Una referencia desde otro manuscrito, incluso archivado, bloquea la operación. Para confirmar debes escribir el título exacto. Conserva tu copia antes: no existe deshacer ni un respaldo oculto recuperable.

La eliminación trabaja por checkpoints. Se muestra progreso; puedes reanudar tras cerrar o perder conexión. Antes del primer lote se puede cancelar. Después solo se puede reanudar hasta finalizar. Mientras se ejecuta, la cuenta conserva lectura, pero las escrituras del nuevo archivo y los palacios quedan bloqueadas para evitar referencias nuevas. El estudio clásico es independiente.

Los loci no se eliminan: pasan a descanso conservando nombre, anclaje, historial y contador vitalicio. En Palacios de memoria, **Finalizar descanso** permite reutilizarlos por decisión explícita. No se impone una duración de descanso como ley científica.

## Fundamento y límites

La recuperación activa y el espaciamiento tienen evidencia experimental bajo condiciones específicas (Roediger y Karpicke, 2006; Cepeda y otros, 2006). La distinción histórica entre memoria rerum y verborum aparece en la Rhetorica ad Herennium III; Quintiliano, Institutio oratoria XI.2, aporta referencias sobre división, continuidad y comprobación. Son antecedentes, no ensayos de esta aplicación.

La secuencia acumulativa, los topes por pistas, los perfiles y el descanso son decisiones de producto configurables. Ritmo, canto e imágenes son opciones. No se atribuye validación científica integral a la marca ni se presenta como implementación oficial de una metodología externa.
