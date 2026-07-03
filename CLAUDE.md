# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `web/` — Vite + React 19 + TypeScript + Tailwind v3. Panel estático informativo ([web/src/App.tsx](web/src/App.tsx)); el flujo real pasa por WhatsApp.
- `supabase/` — Schema en `migrations/` y la Edge Function (`functions/whatsapp-webhook/`).

No hay tooling compartido en la raíz: los comandos se corren desde `web/` o vía Supabase CLI.

## Commands

Todos los `npm` se corren desde `web/`.

```bash
cd web
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build
npm run lint       # eslint .
npm run preview    # serve dist/
```

No hay framework de tests configurado.

Edge Function (Supabase CLI):

```bash
supabase functions deploy whatsapp-webhook
supabase db push   # aplica migrations en supabase/migrations/
```

Los secrets de la Edge Function se configuran en el proyecto Supabase, **no** se leen del `.env` local. Ver `web/.env.example` para la lista completa.

## Gotchas técnicos

- **`verify_jwt = false` para el webhook.** [supabase/config.toml](supabase/config.toml) lo desactiva para `whatsapp-webhook`. Sin eso, Supabase responde **401 `UNAUTHORIZED_NO_AUTH_HEADER`** antes de invocar la función y el `MSG ID:` nunca aparece en logs. Meta no manda `Authorization` header, así que es obligatorio. Si redeployás la function, asegurate de hacerlo con el `config.toml` presente (o `supabase functions deploy whatsapp-webhook --no-verify-jwt`).
- **Los imports usan extensión `.js` aunque el entrypoint es `.ts`.** Los módulos de `_shared/` son JS planos consumidos por Deno — no "arreglar" las extensiones.
- **Hack de teléfono argentino** en [supabase/functions/_shared/whatsapp.js](supabase/functions/_shared/whatsapp.js): los números salientes que empiezan en `549` se reescriben a `54` antes de enviar (WhatsApp drops el `9` móvil para AR).
- **Boss lookup es global por teléfono** (`users.phone_number`), pero la unique constraint es `(company_id, phone_number)`. Mismo teléfono en dos companies rompe el `.maybeSingle()`. No pasa hoy, pero conviene saberlo.
- **`BOT_ENABLED`** es una const hard-coded al tope del webhook — flipearla a `false` desactiva el procesamiento sin tocar secrets.
- **El schema en disco está incompleto.** `supabase/migrations/` sólo tiene `001_init.sql` y `002_google_sheets.sql`. Estos objetos viven sólo en el proyecto Supabase live:
  - tabla `pending_actions` (estado conversacional)
  - tabla `processed_messages` (idempotencia, con UNIQUE en `message_id`)
  - columna `employees.hourly_rate` (la "migración 003" se aplicó a mano)
  Para una DB fresca hay que crearlas a mano o sumar las migraciones faltantes.
- **`companies.google_sheet_name` es el nombre de la PESTAÑA del spreadsheet, no del documento.** El spreadsheet también debe tener las pestañas `Semana 1`..`Semana 4` con headers. Si la pestaña principal no existe, las escrituras fallan con `Unable to parse range` — el bot ahora avisa al boss en ese caso.
- **Semanas tope en 4**: `getWeekOfMonth` ([supabase/functions/_shared/googleSheets.js](supabase/functions/_shared/googleSheets.js)) capea en 4, así que la 5ta semana calendario de un mes cae en `Semana 4`.
- **Edits de horas hacen delta, no recálculo**: `updateWeeklySheetOnEdit` resta horas viejas y suma nuevas en la hoja de semana en vez de recomputar desde la DB. Si el total acumulado drifta, ese es el lugar a mirar.

---

# Contexto del Proyecto — WhatsApp Hour Logger

## Qué es
Bot de WhatsApp para registrar horas laborales. Los jefes le mandan mensajes (texto o audio) al bot y este guarda las horas en Supabase y en Google Sheets.

## Stack
- Supabase Edge Functions (Deno/TypeScript)
- WhatsApp Business API (Meta)
- Google Sheets API (service account)
- OpenAI Whisper (transcripción de audio)
- GPT-4o-mini (normalización de audio a texto estructurado)

## Archivos clave
- `supabase/functions/whatsapp-webhook/index.ts` — función principal
- `supabase/functions/_shared/parser.js` — parsea los mensajes entrantes
- `supabase/functions/_shared/googleSheets.js` — escribe en Google Sheets
- `supabase/functions/_shared/audio.js` — transcribe y normaliza audios
- `supabase/functions/_shared/employeeMatch.js` — búsqueda fuzzy de empleados
- `supabase/functions/_shared/whatsapp.js` — envía mensajes de WhatsApp
- `supabase/functions/_shared/config.js` — env vars

## Base de datos (Supabase)
```sql
companies        (id, name, google_spreadsheet_id, google_sheet_name)
users            (id, company_id, name, phone_number, role)  -- los "jefes"
employees        (id, company_id, name, active, hourly_rate)
work_logs        (id, company_id, employee_id, date, start_time, end_time, worked_hours, boss_id)
pending_actions  (id, phone, company_id, type, payload)  -- estado conversacional
processed_messages (id, message_id UNIQUE, created_at)   -- idempotencia
```

## Google Sheets
- Un spreadsheet por empresa
- Hoja principal: `Registros` con header `Fecha | Nombre | Entrada | Salida | HorasTrabajadas | Jefe`
- Hojas de semana: `Semana 1`, `Semana 2`, `Semana 3`, `Semana 4`
  - Header: `Nombre | Horas Totales | Valor Hora | Total`
  - Semanas = filas del calendario (lunes a domingo)
  - Semana 1 = primer lunes del mes

## Comandos WhatsApp implementados
| Comando | Descripción |
|---|---|
| `Juan 8` | Registra 8hs para Juan hoy |
| `Juan 9 17` | Registra entrada 9hs salida 17hs |
| `Juan 30/03/2026 6` | Registra 6hs para Juan en fecha específica |
| `Juan, 8 horas` / `Juan, 8hs` | Sufijos opcionales `h`, `hs`, `hora`, `horas` |
| `Juan 2026-06-02 8` | También acepta fecha en formato ISO |
| `HORAS\nEmpleado: Juan\nFecha: 20/03/2026\nEntrada: 09:00\nSalida: 18:00` | Formato con etiquetas (orden libre) |
| `ALTA Juan Perez` | Crea empleado (ignora tildes y mayúsculas para deduplicar) |
| `BAJA Juan Perez` | Desactiva empleado |
| `EMPLEADOS` | Lista empleados activos |
| `TARIFAS` | Lista empleados con su tarifa |
| `TARIFA Juan Perez 1500` | Setea valor hora |
| `EXPORTAR` | Manda link de descarga del xlsx |
| `BORRAR MES` | Pide confirmación + link exportar, borra BD + todas las hojas |
| `BORRAR SEMANA 1` | Pide confirmación, borra esa semana |

Todos los comandos son case-insensitive (`alta`, `tarifa`, `empleados`, etc. funcionan).

## Comportamiento al registrar horas
- Si ya existe registro → upsert + mensaje "✏️ Registro actualizado... Antes: Xh → Ahora: Yh" + edita fila en Sheets + actualiza hoja de semana
- Si es nuevo → insert + append en Sheets + suma en hoja de semana
- Si hay ambigüedad de nombre → pregunta con lista numerada, guarda en `pending_actions`. Resoluble por **número** o por **apellido/nombre completo** (texto o audio).
- Lo mismo aplica a `TARIFA` (ambigüedad de nombre → flujo de selección).
- Fechas se muestran en formato `dd/mm/yyyy` en WhatsApp **y** en el Sheet.
- Números (horas, tarifas, totales) se muestran con coma decimal (`1500,50`), tanto en WhatsApp como en el Sheet.

## Idempotencia
Insert atómico en `processed_messages`. Si falla con código `23505` = duplicado, se ignora.

## Audio
1. Whisper transcribe el audio
2. GPT-4o-mini normaliza el texto al formato que entiende el parser. El system prompt cubre **todos** los comandos del bot (`HORAS`, `EMPLEADOS`, `ALTA`, `BAJA`, `TARIFA`, `EXPORTAR`, `BORRAR MES`, `BORRAR SEMANA N`). Si agregás un comando nuevo al parser, agregalo también al prompt en [supabase/functions/_shared/audio.js](supabase/functions/_shared/audio.js).
3. Si el audio no encaja en ningún comando, GPT devuelve `NO_ENTENDIDO` y el webhook responde "❓ No entendí el audio". Si falla Whisper / GPT, responde "❌ No pude procesar el audio".
4. El parser procesa el resultado igual que un texto.

## Migraciones aplicadas
- `001_init.sql` — schema inicial
- `002_google_sheets.sql` — columnas google en companies
- `003_hourly_rate.sql` — columna hourly_rate en employees

## Configuración Meta / WhatsApp — ESTADO ACTUAL

### App activa: gestorHorasApp
- **App ID:** 2328673507658966
- **Portfolio:** Emmagine (business_id: 1728627341884638)
- **Estado:** Publicada ✅
- **WhatsApp Business Account ID:** 1533199698197026

### Número del bot
- **Número:** +54 9 223 691-8330 (chip prepago dedicado)
- **Phone Number ID:** 1026252447249285
- **Estado:** Conectado ✅

### Supabase Secrets configurados
- `WHATSAPP_PHONE_NUMBER_ID` → 1026252447249285
- `WHATSAPP_ACCESS_TOKEN` → token permanente de usuario del sistema de Emmagine
- `WHATSAPP_VERIFY_TOKEN` → gestorHoras2026
- `GOOGLE_SERVICE_ACCOUNT_JSON` → configurado
- `OPENAI_API_KEY` → configurado

### Webhook
- URL: `https://ssxwvzmfdawajmxcwkxm.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: `gestorHoras2026`
- Campo suscripto: `messages` ✅

### App vieja (NO usar)
- **gestorHoras** (App ID: 2215618618968515) — portfolio Emmanuel Legrottaglie
- Tiene número de prueba +1 555-189-9202 — NO funciona en producción
- Verificación del negocio trabada "En revisión"

## Testing

Ver [TESTING.md](TESTING.md) — batería completa de pruebas (texto + audio) con resultados de cada ronda de QA. Pasarla entera antes de cada release.

## Pendientes / known limitations

- Re-tarifar y recalcular semanas pasadas (hoy la tarifa nueva sólo aplica a registros futuros).
- `BORRAR MES` borra TODA la DB de la empresa, no filtra por mes calendario.
- No hay comando para borrar un registro puntual (solo MES / SEMANA).
- Filas legacy en `Registros` con fecha ISO conviven con las nuevas en `dd/mm/yyyy` hasta hacer `BORRAR MES` + recargar.

## Pendiente a futuro — Modelo SaaS
- Un solo número de WhatsApp compartido por todas las empresas
- Onboarding 100% por WhatsApp con comandos admin
- Tabla `admins` con números autorizados
- Comandos: `NUEVA EMPRESA`, `NUEVO JEFE`, `LISTAR EMPRESAS`, `BAJA EMPRESA`
- Sin panel web — todo por WhatsApp
- Modelo de cobro: suscripción mensual por empresa
