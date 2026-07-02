# TESTING — Batería de pruebas WhatsApp Hours

Checklist completo para pasar antes de cualquier release.

## Cómo usar este archivo

- Antes de cada release / cambio grande: pasar bloques 1 a 9 + el bloque "Antes de salir a prod" si vas a vender.
- Antes de una iteración chica: pasar al menos los bloques 1, 2, 4, 5 y 8.
- Las cosas con `[ ]` son por hacer; pasarlas a `[x]` cuando ya las verificaste en esa pasada.

---

## 0. Setup previo

- [x ] Boss tester registrado en `users` con el número del chip nuevo
- [x ] Tu número personal NO está en `users` (para probar el "no autorizado")
- [x ] Empresa tester con `google_spreadsheet_id` y `google_sheet_name` (default `Registros`) seteados en `companies`
- [x ] Spreadsheet con las hojas: `Registros`, `Semana 1`..`Semana 4`, headers en cada una
- [x ] Spreadsheet compartido con el email del service account
- [x ] OpenAI con saldo suficiente
- [x ] Última versión de la Edge Function deployada (`supabase functions deploy whatsapp-webhook`)
- [x ] `verify_jwt = false` aplicado al webhook (ver [supabase/config.toml](supabase/config.toml))

---

## 1. Autorización

- [x ] Desde un número NO registrado mandá `EMPLEADOS` → `⛔ Número no autorizado`
- [x ] Desde un número NO registrado mandá `Juan 8` → mismo error
- [x ] Desde un número NO registrado mandá un audio → mismo error

---

## 2. ALTA / BAJA / EMPLEADOS / TARIFAS

Estado inicial: borrar todo (`BORRAR MES` con `1`) y empezar limpio.

### Alta
- [x ] `ALTA Juan Perez` (inline) → "✅ Empleado creado: Juan Perez"
- [x ] `ALTA\nJuan Sosa` (bloque) → "✅ Empleado creado"
- [x ] `ALTA María García` (con tilde) → "✅ Empleado creado"
- [x ] `ALTA Juan Perez` repetido → "⚠️ El empleado ya existe"
- [x ] **Tildes**: `ALTA Juan Pérez` (con tilde) → debe decir que ya existe "Juan Perez" — NO crear duplicado
- [x ] `alta pedro` (lowercase) → debería crear
- [x ] `ALTA` solo → mensaje de error con ejemplo

### Baja
- [x ] `BAJA Juan Sosa` → "✅ Empleado dado de baja: Juan Sosa"
- [x ] `EMPLEADOS` → Juan Sosa NO aparece más
- [x ] `BAJA Juan Sosa` repetido → "No encontré al empleado" (porque ya está inactivo)
- [x ] `ALTA Juan Sosa` (reactivar) → "✅ Empleado reactivado"
- [x ] `BAJA Inexistente` → "No encontré al empleado"
- [x ] `BAJA Juan` con dos Juan activos → "Encontré varios empleados, usá el nombre completo"

### Empleados
- [x ] `EMPLEADOS` con 0 → "No hay empleados activos"
- [x ] `EMPLEADOS` con 12 → lista numerada `1. ... 12. ...` (sin emojis)
- [x ] `empleados` lowercase → idem

### Tarifa
- [x ] `TARIFA Juan Perez 1500` → "✅ Tarifa actualizada / Valor hora: $1500"
- [x ] `TARIFA Juan Sosa 1500.50` → "Valor hora: $1500,50"
- [x ] `TARIFA Juan Sosa 1500,50` (coma) → idem
- [x ] **Ambigüedad de TARIFA**: `TARIFA Juan 2000` con dos Juan → lista numerada + "Responde con el número del empleado"
- [x ] Responder `1` a la ambigüedad → tarifa aplicada al elegido
- [x ] `TARIFA inexistente 1500` → "No encontré"
- [x ] Bloque: `TARIFA\nJuan Perez 1800` → debería andar
- [x ] `tarifa juan 1900` (lowercase) → idem

### Tarifas (nuevo comando)
- [x ] `TARIFAS` → lista `1. Nombre — $1500` o `— sin tarifa` si no tiene
- [x ] `tarifas` lowercase → idem

---

## 3. Registro de horas — formato one-line (texto)

- [x ] `Juan Perez 8` → registra 8h hoy, "✅ Horas registradas / Fecha: dd/mm/yyyy"
- [x ] `Juan Perez 09:00 18:00` → start_end (9h)
- [x ] `Juan Perez 02/06/2026 6` → 6h en fecha específica
- [x ] `Juan Perez 02/06/2026 09:00 18:00` → start_end en esa fecha
- [x ] **Sufijo "horas"**: `Juan, 8 horas` → debe registrar (regex amplió)
- [x ] **Sufijo "hs"**: `Juan, 8hs` → debe registrar
- [x ] **Sufijo "h"**: `Juan, 8h` → debe registrar
- [x ] `Juan, 09:00, 18:00` (con comas) → registra
- [x ] **ISO en línea**: `Juan 2026-06-02 8` → registra con esa fecha
- [ x] **ISO con horarios**: `Juan 2026-06-02 09:00 18:00` → start_end
- [x ] **Overnight**: `Juan 22:00 06:00` → registra 8h (no negativo)
- [x ] **Re-registro mismo día**: `Juan Perez 5` (después de 8) → "✏️ Registro actualizado / Antes: 8h → Ahora: 5h"
- [x ] Decimales: `Juan 8,5` → registra 8,5h
- [x ] **En Sheet**: fecha en formato `dd/mm/yyyy` (no ISO), horas con coma si tienen decimales

---

## 4. Registro de horas — formato HORAS bloque (texto)

- [x ] Bloque con etiquetas y entrada/salida:
  ```
  HORAS
  Empleado: Juan Perez
  Fecha: 03/06/2026
  Entrada: 09:00
  Salida: 18:00
  ```
- [x ] Bloque con etiquetas y horas:
  ```
  HORAS
  Empleado: Juan Perez
  Horas: 8
  ```
- [x ] **Orden alterado con etiquetas**:
  ```
  HORAS
  Empleado: Juan Sosa
  Entrada: 09:00
  Salida: 15:00
  Fecha: 03/06/2026
  ```
- [x ] **Sin etiquetas, fecha al final** (caso del feedback):
  ```
  HORAS
  Juan Sanchez
  09:00
  18:00
  03/06/2026
  ```
  → ahora debería tomar la fecha 03/06/2026 (antes tomaba hoy)
- [x ] Bloque sin etiquetas posicional clásico:
  ```
  HORAS
  Juan Perez
  09:00
  18:00
  ```
- [ x] Lowercase: `horas\n...` → debería andar
- [x ] Mal formado: `HORAS\nNo se que` → mensaje de error con ejemplo (no genérico)

---

## 5. Ambigüedad de empleado

Pre: `Juan Perez` y `Juan Sosa` activos.

- [x ] `Juan 8` → "⚠️ Encontré varios empleados: 1. Juan Perez 2. Juan Sosa\n\nResponde con el número o su apellido"
- [x ] Responder `1` → registra para Juan Perez
- [x ] Verificar que la fila va al Sheet correcto
- [x ] **Resolver por apellido**: `Juan 8`, responder `Perez` (texto) → debería resolver
- [x ] **Resolver por apellido con tilde**: ambiguar y responder `Pérez` → debería resolver (ignora tildes)
- [ x] `Juan 8`, responder `99` → "Número inválido"
- [x ] `Juan 8`, responder `EMPLEADOS` (otro comando) → debería procesar el comando nuevo, no pisarse con el pending

---

## 6. EXPORTAR / BORRAR

- [x ] `EXPORTAR` → link `docs.google.com/.../export?format=xlsx`. Abrir, baja el xlsx con datos.
- [x ] `exportar` lowercase → idem
- [x ] `BORRAR SEMANA 2` → "⚠️ ¿Confirmás...?" + link de export
- [x ] Responder `2` → "❌ Borrado cancelado"
- [x ] `BORRAR SEMANA 2`, responder `1` → "🗑️ Semana 2 borrada"
- [x ] Verificar en DB que `work_logs` de esa semana se borraron
- [x ] Verificar en Sheet que `Semana 2` quedó vacía (solo header) y otras semanas no cambiaron
- [x ] `BORRAR SEMANA 5` → debería rechazar (solo 1-4)
- [x ] `BORRAR MES` + `1` → todo limpio (DB + 4 hojas + Registros)
- [x ] `BORRAR MES` cuando ya está vacío → no debería romper
- [x ] **Heads-up conocido**: hoy `BORRAR MES` borra TODA la DB de la empresa, no sólo el mes actual. Comportamiento confirmado por el cliente, no es bug.

---

## 7. Audios — todos los comandos

Estado base: 2-3 empleados activos, alguno con tarifa.

### Admin
- [x ] 🎙 "empleados" → lista
- [x ] 🎙 "mostrame los empleados" → lista
- [ x] 🎙 "listame el personal" → lista
- [x ] 🎙 "tarifas" → lista de tarifas
- [x ] 🎙 "mostrame las tarifas" → lista
- [x ] 🎙 "exportar" → link
- [x ] 🎙 "mandame el excel" → link
- [x ] 🎙 "dame el archivo de horas" → link
- [x ] 🎙 "dar de alta a Pedro Gómez" → crea (era bug → fix con `firstWord`)
- [x ] 🎙 "sumá a María González al equipo" → crea
- [x ] 🎙 "bajá a Pedro Gómez" → da de baja
- [x ] 🎙 "la tarifa de Juan Perez es mil quinientos" → setea 1500
- [x ] 🎙 "borrá la semana 2" → pide confirmación
- [x ] 🎙 "uno" (audio) en respuesta a la confirmación → debería confirmar (GPT lo mapea a "1")
- [x ] 🎙 "confirmar" (audio) → idem
- [x ] 🎙 "cancelar" (audio) → cancela
- [x ] 🎙 "borrame todo el mes" → confirmación; 🎙 "sí" → debería confirmar

### Horas
- [x ] 🎙 "Juan trabajó 8 horas hoy" → registra
- [x ] 🎙 "Juan trabajó 8 horas ayer" → registra con fecha de ayer
- [x ] 🎙 "Juan entró a las 9 y salió a las 17" → start_end
- [ x] 🎙 "el lunes Juan hizo 6 horas" → fecha del lunes pasado
- [x ] 🎙 "Juan trabajó de 9 a 17 el martes" → start_end con fecha del martes
- [x ] 🎙 "Pedro hizo 7 horas el 15 de junio" → registra con fecha 15/06

### Ambigüedad por audio
- [ ] Con `Juan Perez` y `Juan Sosa` activos: 🎙 "Juan trabajó 8 horas" → debería disparar el flujo de ambigüedad
- [x ] 🎙 "Perez" en respuesta al pending → debería resolver al Juan Perez
- [x ] 🎙 "uno" en respuesta al pending → debería elegir el primero
- [x ] Texto `Perez` al pending → idem

### Negativos
- [x ] 🎙 "hola cómo estás" → "❓ No entendí el audio"
- [x ] 🎙 (audio en silencio 1s) → "❓ No entendí" o "❌ No pude procesar"
- [x ] 🎙 "qué hora es" → NO_ENTENDIDO

### Calidad
- [x ] 🎙 audio con ruido de fondo → ver si Whisper sigue entendiendo
- [x ] 🎙 audio largo (>30s) → debería andar
- [x ] 🎙 hablar rápido → robustez Whisper

---

## 8. Edge cases técnicos

- [x ] **Overnight**: `Juan 22:00 06:00` → 8h
- [x ] **Fecha ISO en bloque HORAS sin etiquetas**: ya cubierto en bloque 4
- [x ] **Idempotencia**: si Meta retransmite, buscar `Mensaje duplicado ignorado` en logs
- [x ] **Sticker/imagen**: bot no responde, no rompe
- [x ] **Empleado dado de baja**: `Juan Perez 8` después de `BAJA Juan Perez` → "No encontré"
- [x ] **Cambiar tarifa después de registros**: setear tarifa 2000, ya hay 8h registradas. Registrar 3h más en la misma semana → la fila de `Semana N` recalcula con la NUEVA tarifa para el total acumulado.

  ⚠️ **Known limitation**: hoy semanas pasadas no se recalculan cuando cambia la tarifa. Si setás tarifa nueva, sólo aplica a los registros que se hagan después. **Mejora pendiente** (ver § Pendientes).

---

## 9. Antes de salir a prod

- [ ] Pasar bloques 1-8 completos en un solo run sin errores nuevos
- [ ] Migraciones: agregar a `supabase/migrations/` los SQL de `pending_actions`, `processed_messages` y `employees.hourly_rate` (hoy sólo en live)
- [ ] WhatsApp Business — verificación del negocio aprobada por Meta (sin esto, modo desarrollo y sólo testers pueden chatear)
- [ ] OpenAI: configurar **auto-recharge** o alerta de bajo saldo
- [ ] Backup automático de la DB de Supabase (al menos snapshots diarios)
- [ ] Definir política de retención a fin de mes (Sheets se ensucian con los meses)
- [ ] Onboarding documentado: cómo crear empresa nueva (DB + Sheet + service account + secrets)
- [ ] Plan mínimo de soporte (canal, tiempos de respuesta)
- [ ] Términos / política de uso (legal mínimo si cobrás)

---

## Roadmap post-piloto

Ideas para cuando el cliente vuelva a las 2-3 semanas con feedback real (no implementar antes — diseñá con datos de uso, no con suposiciones).

- **Tracking de gastos.** Pestaña nueva `Gastos` en el mismo spreadsheet con columnas `Fecha | Concepto | Monto | Categoría | Cargado por`. Nueva tabla `expenses` en DB. Comandos:
  - `GASTO 5000 nafta` → registra gasto
  - `GASTO 5000 nafta combustible` → con categoría
  - `GASTOS` → lista los del mes con total
  - 🎙 "gasté 5000 en nafta"
  - Preguntas a definir con cliente antes: ¿quién carga gastos (solo boss o también empleados)?, ¿categorías fijas o libres?, ¿pagos a empleados van acá o aparte?, ¿se asignan a proyectos/clientes?
- **Pago a empleados** (`PAGO Juan 50000`): registra cuándo se le pagó cuánto, se cruza con horas no pagadas. Sólo si el cliente lo pide explícitamente.
- **Resumen mensual**: pestaña `Resumen mes` que cruza horas + gastos + pagos = neto por empleado y total.

---

## Pendientes / known limitations

Cosas identificadas que no están en el código todavía. Discutir con cliente antes de invertir.

- **`BORRAR SEMANA N` no limpia todo en DB**: el rango de fechas que borra se calcula con el mes calendario actual. Si en `Semana N` del sheet hay registros de otro mes (ej: cargados en una fecha futura/pasada), esos work_logs no se borran de la DB. El cliente actual lo acepta porque "todavía está en el resumen del mes", pero conviene preguntar:
  - **opción A** (actual): borrar de DB sólo los registros del mes en curso que caen en esa semana.
  - **opción B**: borrar todos los work_logs de los empleados que aparecen en `Semana N` del sheet, sin importar el mes.
- **`BORRAR MES` borra TODA la DB de la empresa**: no filtra por mes calendario. El cliente actual lo acepta (a fin de mes ya tiene el xlsx).
- **Borrar registro individual**: no hay comando para borrar un único día de un empleado. Posible: `BORRAR Juan 03/06/2026`.
- **Filas legacy en Sheet con fecha ISO**: antes del fix de fecha quedaron filas con `2026-05-21`. El código nuevo lee ambos formatos al buscar, pero las filas viejas quedan visualmente inconsistentes hasta `BORRAR MES` + recargar.

---

## Resultados del testing del 2026-05-20

### Resuelto

- ✅ `ALTA Juan Perez` (inline) → parser detecta categoría por primera palabra.
- ✅ Tildes en ALTA (deduplica `Juan Perez` vs `Juan Pérez`).
- ✅ BAJA no tenía handler → agregado.
- ✅ EMPLEADOS sin emojis (`1. Nombre`).
- ✅ TARIFA con ambigüedad → flujo de selección.
- ✅ Comando `TARIFAS`.
- ✅ Formato `$1500,50` (coma).
- ✅ `Juan, 8 horas` / `Juan, 8hs` / `Juan 2026-06-02 8`.
- ✅ Bloque HORAS sin etiquetas con fecha en cualquier posición.
- ✅ Mensaje de error de HORAS con ejemplo.
- ✅ "dar de alta a X" por audio.

---

## Resultados del testing del 2026-05-27

### Resuelto en esta iteración

- ✅ 🔴 **`emma 8,5` → 21h** (overnight bug): el parser probaba `start_end` antes que `hours_only`, así que `8,5` se interpretaba como `start=8 end=5` (= 20h overnight). Ahora prueba `hours_only` primero.
- ✅ 🔴 **Trabado en "Respondé 1 para confirmar"**: si ahora mandás otro comando (ej: `Empleados`) mientras hay un pending de borrado, el pending se cancela y se procesa el comando nuevo.
- ✅ 🔴 **Apellido / "Sosa" por audio en ambigüedad no resolvía**: el GPT devolvía `NO_ENTENDIDO` porque "Sosa" sola no es comando. Ahora, cuando hay pending de selección o confirmación, el webhook **bypasea GPT** y matchea la transcripción cruda contra los candidatos. "Sosa", "uno", "sí", etc. resuelven directo.
- ✅ **`Tarifas` listaba `$0` para empleados sin tarifa** (el default de la columna es 0, no NULL): ahora muestra `— sin tarifa`.
- ✅ **Fecha en `Registros` seguía como `yyyy-mm-dd`**: Google Sheets parseaba el `dd/mm/yyyy` que mandábamos como fecha y la mostraba con el formato automático ISO. Ahora se manda con prefijo `'` para forzarla como texto literal. Las filas legacy escritas antes del fix siguen en ISO hasta que se vuelvan a escribir.
- ✅ **Tarifa nueva no actualizaba semanas pasadas**: ahora `TARIFA Juan X` recorre las 4 hojas semanales y recalcula `Total = Horas × X` para ese empleado.
- ✅ **`tarifas` por audio no entendía**: agregué ejemplos few-shot al prompt.
- ✅ **"uno" / "sí" por audio en confirmación a veces fallaba**: bypass directo (sin GPT) con un mapa verbal→número.
- ✅ **"Juan trabajó el martes" daba fecha incorrecta**: el prompt ahora aclara "el día más reciente que YA pasó", y se le pasa al GPT el día de la semana actual.

### A verificar en próxima pasada (15-20 min, no hace falta correr todo de nuevo)

**Smoke tests críticos — verificar que no rompí lo que ya andaba:**

- [0 ] `Juan 9 17` (sin coma) → registra start_end 9→17, NO se confunde con hours_only (probar este pre/post cambio del orden del parser)
- [x ] Audio "empleados" SIN pending activo → lista (el bypass de pending no debería interferir con el camino normal)
- [x ] Mirar el sheet `Registros`: la columna **Fecha** ahora se ve `dd/mm/yyyy` en filas nuevas (las legacy en ISO siguen como están, es esperado)

**Verificación de los fixes nuevos:**

- [x ] `emma 8,5` → registra 8,5h (no 21h)
- [x ] `Juan 5,5` con ambigüedad → resolver con `2` → debería registrar 5,5h (no 0)
- [x ] Mientras hay `BORRAR MES` pendiente, mandá `Empleados` → debería procesar empleados y limpiar el pending
- [ ] Ambigüedad `Juan 8` con dos Juan → 🎙 `Sosa` debería resolver (sin GPT)
- [ ] Ambigüedad → 🎙 `uno` → debería resolver al primero
- [ ] `BORRAR MES` → 🎙 `sí` o `confirmar` → debería confirmar
- [x ] `TARIFA Juan Perez 2000` con horas ya cargadas en Semana 2 y Semana 3 → ambos sheets recalculan Total con 2000
- [x ] 🎙 `Tarifas` → debería listar (no `NO_ENTENDIDO`)
- [x ] 🎙 "Juan trabajó el martes" hoy → debería tomar el martes más reciente
- [x ] `TARIFAS` con un empleado sin tarifa → `— sin tarifa` (no `$0`)

---

## Hotfix posterior (mismo 2026-05-27, después del primer redeploy)

### Bugs encontrados en la pasada anterior

- ✅ 🔴 **`Juan 9 17` rompía** dando "No encontré al empleado Juan 9". El swap del orden del parser introdujo este bug: `hours_only` lazy matcheaba `Juan 9` como nombre + `17` como horas. **Fix**: el regex de nombre ahora prohíbe dígitos.
- ✅ 🔴 **🎙 `Sosa` / `Perez` por audio no resolvía la ambigüedad** (a pesar del bypass de GPT). Causa raíz: Whisper transcribe con puntuación final (`"Sosa."`) y el matcher tokenizaba estricto. **Fix**: `normalizeHumanText` ahora también saca puntuación.
- ✅ **🎙 "Juan ocho" / "Pedro cinco horas"** daba NO_ENTENDIDO: el prompt no enseñaba números en palabras. **Fix**: regla explícita y ejemplos few-shot (`ocho` → 8, `ocho y media` → 8,5).

### Limitación conocida (no es bug del bot)

- A veces Whisper transcribe mal palabras clave (ej: "martes" → "mar de"). Cuando eso pasa, GPT no puede recuperar el sentido y cae a fecha de hoy o devuelve NO_ENTENDIDO. **Mitigación del usuario**: repetir articulando. No hay fix por código sin cambiar de proveedor (Groq Whisper-v3 podría ser mejor pero introduce otros riesgos).

### Re-verificar después del segundo deploy

- [x ] `Juan 9 17` → registra start_end 9→17 (antes daba "Juan 9 no existe")
- [ x] `Perez 9 17` → idem para Perez
- [0 ] 🎙 `Sosa` en ambigüedad → resuelve (antes daba "No entendí")
- [0 ] 🎙 `Perez` en ambigüedad → resuelve
- [x ] 🎙 "Juan ocho" → registra 8h
- [x ] 🎙 "Pedro cinco horas" → registra 5h
- [x ] 🎙 "Juan ocho y media" → registra 8,5h
