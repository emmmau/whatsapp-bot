# ONBOARDING — Dar de alta una empresa nueva

Pasos exactos para sumar un cliente nuevo al bot. Hoy es manual; se puede automatizar más adelante.

Tiempo estimado: **15-20 minutos por empresa**.

---

## Lo que necesitás antes de arrancar

- Nombre de la empresa.
- Nombre del jefe (boss) y su número de WhatsApp con código de país. Ej: `5492235494105` (sin `+`, sin espacios).
- **Cuenta de Google del cliente** (Gmail o Google Workspace) — para compartirle el Sheet.
- Acceso al [Supabase Dashboard](https://supabase.com/dashboard) del proyecto.
- Acceso al Google account que va a ser dueño del spreadsheet del cliente.
- El email del service account de Google (está en el secret `GOOGLE_SERVICE_ACCOUNT_JSON`, campo `client_email`).

---

## 1. Crear el Google Spreadsheet

1. Entrar a [sheets.google.com](https://sheets.google.com) y crear un spreadsheet nuevo.
2. Nombrarlo descriptivamente: `Horas — <Nombre Empresa>` (ej: `Horas — Oasis`). El nombre del documento es libre — solo importa internamente.
3. **Crear 5 pestañas** con estos nombres exactos (case-sensitive):

| Pestaña | Headers (fila 1, columnas A en adelante) |
|---|---|
| `Registros` (o el nombre que vayas a usar) | `Fecha`, `Nombre`, `Entrada`, `Salida`, `HorasTrabajadas`, `Jefe`, `Empresa` |
| `Semana 1` | `Nombre`, `Horas Totales`, `Valor Hora`, `Total` |
| `Semana 2` | (igual que Semana 1) |
| `Semana 3` | (igual que Semana 1) |
| `Semana 4` | (igual que Semana 1) |

⚠️ El nombre que le pongas a la pestaña principal **tiene que coincidir EXACTO** con `companies.google_sheet_name` en el INSERT del paso 3. Si la pestaña se llama `Registros` y en DB ponés `Horas Oasis`, el bot va a fallar con "no se pudo actualizar la planilla". Tener cuidado con espacios y mayúsculas.

4. **Compartir** el spreadsheet con DOS emails (botón "Compartir" arriba a la derecha):
   - El email del **service account**, permiso **Editor** (el bot lee/escribe acá).
   - El email del **cliente** (jefe), permiso **Viewer** (puede ver y descargar el xlsx, pero no editar — si edita celdas se descalibran los totales que mantiene el bot).
   - Destildar "Notificar a las personas" así no le llega un mail con el link prematuro.
5. Copiar el ID del spreadsheet de la URL. Ej:
   ```
   https://docs.google.com/spreadsheets/d/1VU7fuDxv7gp2ecz7vXk9b08HB6gHpTeB79tZXSNvJzI/edit
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          este es el spreadsheet_id
   ```

---

## 2. (Opcional) Configurar formato del Sheet en castellano

Para que los decimales se muestren con coma (`1500,50`):

- Spreadsheet → Archivo → Configuración → Configuración regional → **Argentina** (o el país que aplique).

Sin esto el sheet puede mostrar `1500.5` en lugar de `1500,50`.

---

## 3. Crear empresa y jefe en la DB

En el SQL Editor de Supabase, correr (reemplazando los valores entre `<>`):

```sql
-- 1. Empresa
INSERT INTO companies (name, google_spreadsheet_id, google_sheet_name)
VALUES (
  '<Nombre Empresa>',
  '<spreadsheet_id del paso 1>',
  '<nombre EXACTO de la pestaña principal>'
)
RETURNING id;
```

⚠️ Anotar el `id` que devuelve la query. Lo necesitás abajo.

```sql
-- 2. Jefe
INSERT INTO users (company_id, name, phone_number, role)
VALUES (
  '<id devuelto arriba>',
  '<Nombre del jefe>',
  '<phone con código país, sin "+"; ej: 5492235494105>',
  'boss'
);
```

⚠️ **El número de teléfono debe ser único en todo el sistema.** Si el cliente nuevo tiene el mismo número que un boss existente (improbable pero posible), va a fallar o pisar al otro. Una persona = una empresa.

---

## 4. Probar end-to-end

Desde el teléfono del jefe nuevo, mandar al número del bot:

1. `AYUDA` → debería responder con la lista de comandos.
2. `ALTA Juan Test` → debería crear el empleado.
3. `Juan 8` → debería registrar 8h hoy. Verificar que aparezca una fila nueva en la pestaña `Registros` y en `Semana N` del spreadsheet.
4. `EXPORTAR` → manda link al xlsx, abrirlo para verificar.
5. `BAJA Juan Test` y borrar la fila del Sheet a mano para dejar limpio.

Si el paso 3 responde "⚠️ no se pudo actualizar la planilla", revisar:
- Nombre de la pestaña principal coincide con `google_sheet_name`.
- Spreadsheet está compartido con el service account.
- Existen las 5 pestañas con los nombres exactos.

---

## 5. Entregar al cliente

Mensaje sugerido para mandarle al jefe:

> ¡Listo! Ya podés usar el bot mandando mensajes a este número.
>
> Para arrancar, mandá `AYUDA` y vas a ver todos los comandos disponibles. Lo más típico:
>
> - `ALTA Juan Pérez` para dar de alta un empleado
> - `TARIFA Juan Pérez 1500` para fijar el valor hora
> - `Juan 8` o `Juan 9 17` para registrar horas
> - `EMPLEADOS` y `TARIFAS` para ver tu lista
> - `EXPORTAR` cuando quieras bajar el Excel
>
> También funciona por audio: decí algo como "Juan trabajó 8 horas hoy" y se registra solo.
>
> Si algo no entendés o anda raro, mandame un mensaje.

---

## Troubleshooting rápido

| Síntoma | Causa probable | Solución |
|---|---|---|
| `⛔ Número no autorizado` | El boss no está en `users`, o el `phone_number` está formateado distinto | Verificar con `select * from users where phone_number like '%<últimos dígitos>%';` |
| `⚠️ No se pudo actualizar la planilla: la pestaña "X" no existe` | El nombre de la pestaña en el sheet no coincide con `companies.google_sheet_name` | Renombrar la pestaña O cambiar `google_sheet_name` en DB |
| `⚠️ permiso de Editor` | Spreadsheet no compartido con el service account | Compartir desde el botón "Compartir" del sheet, permiso Editor |
| Mensajes no llegan al webhook | Algo de Meta/Supabase | Ver [CLAUDE.md](CLAUDE.md) sección Configuración Meta + revisar logs de la Edge Function |
| Audio da `❌ No pude procesar el audio` | OpenAI sin saldo | Cargar saldo en platform.openai.com |

---

## Setup que sólo va una vez (no por cliente)

Estos pasos ya están hechos para el proyecto principal — no hace falta repetirlos por cliente:

- App de WhatsApp en Meta (`gestorHorasApp`, App ID 2328673507658966) verificada y publicada.
- Service account de Google creado y su JSON cargado como secret `GOOGLE_SERVICE_ACCOUNT_JSON` en Supabase.
- API key de OpenAI cargada como secret `OPENAI_API_KEY` con auto-recharge configurado.
- Webhook de WhatsApp apuntando a `https://ssxwvzmfdawajmxcwkxm.supabase.co/functions/v1/whatsapp-webhook` con `verify_jwt = false`.

Ver [CLAUDE.md](CLAUDE.md) para detalles de cada uno.
