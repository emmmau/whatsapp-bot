import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseConfig, getWhatsAppConfig, normalizePhone } from '../_shared/config.js'
import { employeeMatchesQuery } from '../_shared/employeeMatch.js'
import { computeHoursFromStartEnd, parseIncomingMessage } from '../_shared/parser.js'
import { sendWhatsAppText } from '../_shared/whatsapp.js'
import { formatDateDDMMYYYY, formatNumberES, normalizeHumanText } from '../_shared/text.js'
import {
  appendWorkLogToCompanySheet,
  updateWorkLogInSheet,
  updateWeeklySheet,
  updateWeeklySheetOnEdit,
  clearWeekSheet,
  clearAllSheets,
  getExportUrl,
  recalculateEmployeeWeeklyTotals
} from '../_shared/googleSheets.js'
import { transcribeWhatsAppAudio, normalizeAudioWithAI } from '../_shared/audio.js'

console.log("FUNCION NUEVA DEPLOYADA")

const BOT_ENABLED = true

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string
          id: string
          timestamp: string
          text?: { body?: string }
          audio?: { id: string }
          type?: string
        }>
      }
    }>
  }>
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

Deno.serve(async (req) => {
  const url = new URL(req.url)

  // -------- VERIFICACION WEBHOOK --------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')
    const { verifyToken } = getWhatsAppConfig()

    if (mode === 'subscribe' && token === verifyToken && challenge) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('Unauthorized', { status: 401 })
  }

  if (req.method !== 'POST' || !BOT_ENABLED) {
    return new Response('ok')
  }

  const { url: supabaseUrl, serviceRoleKey } = getSupabaseConfig()
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const payload = (await req.json().catch(() => null)) as WhatsAppWebhookPayload | null
  const msg = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? null

  if (!msg?.id) return new Response('ok')

  console.log("MSG ID:", msg.id)

  // 🔒 IDEMPOTENCIA: insert atómico
  const { error: dedupError } = await supabase
    .from('processed_messages')
    .insert({ message_id: msg.id })

  if (dedupError) {
    if (dedupError.code === '23505') {
      console.log("Mensaje duplicado ignorado:", msg.id)
      return new Response('ok')
    }
    console.error("Error inesperado en dedup:", dedupError)
    return new Response('ok')
  }

  const fromPhone = normalizePhone(msg.from)

  // Cargo el pending ANTES de procesar el audio, porque si hay un pending de
  // selección o confirmación, puedo bypassear GPT y usar la transcripción cruda.
  const { data: pending } = await supabase
    .from("pending_actions")
    .select("*")
    .eq("phone", fromPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Mapeo verbal → número/comando, para audios cortos en flujos de pending.
  const verbalToNumber: Record<string, string> = {
    uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5",
    seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
    si: "1", sí: "1", confirmar: "1", confirma: "1", confirmá: "1",
    dale: "1", ok: "1", listo: "1",
    no: "2", cancelar: "2", cancela: "2", cancelá: "2",
  }

  let text = ""

  // -------- PROCESAR TEXTO O AUDIO --------
  if (msg.type === "text") {
    text = (msg.text?.body ?? '').trim()
  } else if (msg.type === "audio" && msg.audio?.id) {
    try {
      const transcription = await transcribeWhatsAppAudio(msg.audio.id)
      console.log("Audio transcripto:", transcription)

      const raw = (transcription ?? "").trim()
      // Lowercase y solo letras/dígitos/espacios; sirve para "uno.", "Uno!", etc.
      const normalized = raw.toLowerCase().replace(/[^a-záéíóúüñ0-9 ]/gi, '').trim()

      // ── Bypass GPT si hay pending de confirmación y el audio dice sí/no/uno/dos ──
      if (pending && pending.type === "confirm_clear" && verbalToNumber[normalized]) {
        text = verbalToNumber[normalized]
      }

      // ── Bypass GPT si hay pending de selección y la transcripción matchea un candidato (o un número verbal) ──
      if (!text && pending && (pending.type === "select_employee_for_worklog" || pending.type === "select_employee_for_rate")) {
        const candidates = pending.payload.employees as Array<{ id: string; name: string }>
        if (verbalToNumber[normalized]) {
          text = verbalToNumber[normalized]
        } else if (raw) {
          // 1) Match estricto por tokens (apellido, nombre completo, etc.)
          let matches = candidates.filter(c => employeeMatchesQuery(c.name, raw))

          // 2) Fallback laxo por substring: tolera typos de Whisper (ej: "Soza" vs "Sosa").
          //    Sólo aplica si el query normalizado tiene ≥3 chars para no matchear cualquier cosa.
          if (matches.length !== 1) {
            const rawNorm = normalizeHumanText(raw)
            if (rawNorm.length >= 3) {
              matches = candidates.filter(c => {
                const empNorm = normalizeHumanText(c.name)
                return empNorm.includes(rawNorm) || rawNorm.includes(empNorm)
              })
            }
          }

          if (matches.length === 1) {
            // Mando el nombre completo del candidato matcheado: el handler downstream
            // hace tokenize estricto y así matchea seguro.
            text = matches[0].name
          }
        }
      }

      // Si nada del pending lo resolvió, paso por GPT como antes.
      if (!text) {
        text = raw ? await normalizeAudioWithAI(raw) : ""
      }
      console.log("Audio normalizado:", text)
    } catch (e) {
      console.error("Error procesando audio:", e)
      text = ""
    }

    if (text === "NO_ENTENDIDO" || !text) {
      await sendWhatsAppText(
        fromPhone,
        text === "NO_ENTENDIDO"
          ? "❓ No entendí el audio. Probá de nuevo o escribilo por texto."
          : "❌ No pude procesar el audio. Probá de nuevo o escribilo por texto."
      )
      return new Response('ok')
    }
  }

  if (!text) return new Response('ok')
  console.log("Mensaje a procesar:", text)

  // -1 = inválido (número fuera de rango), null = no resuelve (pasar al parser).
  function resolveEmployeeIndex(input: string, employees: Array<{ id: string; name: string }>): number | null {
    const t = input.trim()
    if (/^\d+$/.test(t)) {
      const idx = Number(t) - 1
      return idx >= 0 && idx < employees.length ? idx : -1
    }
    const matches = employees
      .map((e, i) => ({ i, e }))
      .filter(({ e }) => employeeMatchesQuery(e.name, t))
    if (matches.length === 1) return matches[0].i
    return null
  }

  // ── Selección de empleado para registrar horas ──
  if (pending && pending.type === "select_employee_for_worklog") {
    const employees: Array<{ id: string; name: string }> = pending.payload.employees
    const idx = resolveEmployeeIndex(text, employees)

    if (idx === -1) {
      await sendWhatsAppText(fromPhone, "Número inválido.")
      return new Response("ok")
    }

    if (idx !== null) {
      const { data: boss } = await supabase
        .from('users')
        .select('id, company_id, name')
        .eq('phone_number', fromPhone)
        .maybeSingle()

      const employee = employees[idx]
      const workLog = pending.payload.workLog
      let workedHours = workLog.workedHours

      if (workLog.kind === "start_end") {
        workedHours = computeHoursFromStartEnd(workLog.startTime, workLog.endTime)
      }

      const safeDate = workLog.dateISO?.slice(0, 10)

      const { data: existingLogPending } = await supabase
        .from('work_logs')
        .select('id, worked_hours')
        .eq('employee_id', employee.id)
        .eq('date', safeDate)
        .maybeSingle()

      const wasUpdatePending = !!existingLogPending

      await supabase
        .from("work_logs")
        .upsert(
          {
            company_id: pending.company_id,
            employee_id: employee.id,
            date: safeDate,
            start_time: workLog.startTime ?? null,
            end_time: workLog.endTime ?? null,
            worked_hours: workedHours,
            boss_id: boss?.id
          },
          { onConflict: 'employee_id,date' }
        )

      await supabase.from("pending_actions").delete().eq("id", pending.id)

      if (boss) {
        const { data: empData } = await supabase
          .from('employees')
          .select('hourly_rate')
          .eq('id', employee.id)
          .maybeSingle()

        const hourlyRate = empData?.hourly_rate ?? 0

        const sheetPayload = {
          companyId: boss.company_id,
          employeeName: employee.name,
          bossName: boss.name,
          dateISO: workLog.dateISO,
          startTime: workLog.startTime ?? null,
          endTime: workLog.endTime ?? null,
          workedHours
        }

        let sheetWarningP = ''
        try {
          if (wasUpdatePending) {
            await updateWorkLogInSheet(supabase as any, sheetPayload)
            await updateWeeklySheetOnEdit(supabase as any, sheetPayload, hourlyRate, existingLogPending.worked_hours)
          } else {
            await appendWorkLogToCompanySheet(supabase as any, sheetPayload)
            await updateWeeklySheet(supabase as any, sheetPayload, hourlyRate)
          }
        } catch (e: any) {
          console.error("Error escribiendo en Sheet:", e)
          sheetWarningP = `\n\n⚠️ Se guardó en la base, pero no se pudo actualizar la planilla: ${e?.message ?? e}`
        }

        const baseMsgP = wasUpdatePending
          ? `✏️ Registro actualizado\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(workLog.dateISO)}\nAntes: ${formatNumberES(existingLogPending.worked_hours)}h → Ahora: ${formatNumberES(workedHours)}h`
          : `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(workLog.dateISO)}\nHoras: ${formatNumberES(workedHours)}`

        await sendWhatsAppText(fromPhone, baseMsgP + sheetWarningP)
        return new Response("ok")
      }

      // Si boss no existe (caso defensivo), salgo igual.
      await sendWhatsAppText(
        fromPhone,
        wasUpdatePending
          ? `✏️ Registro actualizado\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(workLog.dateISO)}\nAntes: ${formatNumberES(existingLogPending.worked_hours)}h → Ahora: ${formatNumberES(workedHours)}h`
          : `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(workLog.dateISO)}\nHoras: ${formatNumberES(workedHours)}`
      )
      return new Response("ok")
    }
    // idx === null → no resolvió, cae al parser de abajo
  }

  // ── Selección de empleado para fijar tarifa ──
  if (pending && pending.type === "select_employee_for_rate") {
    const employees: Array<{ id: string; name: string }> = pending.payload.employees
    const idx = resolveEmployeeIndex(text, employees)

    if (idx === -1) {
      await sendWhatsAppText(fromPhone, "Número inválido.")
      return new Response("ok")
    }

    if (idx !== null) {
      const employee = employees[idx]
      const rate = pending.payload.rate as number

      await supabase.from('employees').update({ hourly_rate: rate }).eq('id', employee.id)
      await supabase.from("pending_actions").delete().eq("id", pending.id)

      let sheetWarningR = ''
      try {
        await recalculateEmployeeWeeklyTotals(supabase as any, pending.company_id, employee.name, rate)
      } catch (e: any) {
        console.error("Error recalculando semanas:", e)
        sheetWarningR = `\n\n⚠️ Tarifa guardada en la base, pero no se pudieron recalcular las semanas en la planilla: ${e?.message ?? e}`
      }

      await sendWhatsAppText(
        fromPhone,
        `✅ Tarifa actualizada\nEmpleado: ${employee.name}\nValor hora: $${formatNumberES(rate)}${sheetWarningR}`
      )
      return new Response("ok")
    }
  }

  // ── Confirmación de borrado ──
  if (pending && pending.type === "confirm_clear") {
    // Si el usuario no responde 1/2 sino otro comando válido, cancelamos el
    // pending y dejamos seguir el flujo normal (evita quedar trabado).
    if (text !== "1" && text !== "2") {
      const probe = parseIncomingMessage(text)
      if (probe.kind && probe.kind !== 'error') {
        await supabase.from("pending_actions").delete().eq("id", pending.id)
        // No `return` — sigue al validar jefe + parser de abajo.
      } else {
        await sendWhatsAppText(fromPhone, 'Respondé 1 para confirmar o 2 para cancelar.')
        return new Response('ok')
      }
    }
  }

  // Segundo paso de confirm_clear: si llegamos acá con 1/2, ejecutamos el borrado.
  if (pending && pending.type === "confirm_clear" && (text === "1" || text === "2")) {
    const { data: boss } = await supabase
      .from('users')
      .select('id, company_id, name')
      .eq('phone_number', fromPhone)
      .maybeSingle()

    if (!boss) {
      await sendWhatsAppText(fromPhone, '⛔ Número no autorizado.')
      return new Response('ok')
    }

    if (text === "1") {
      const { data: company } = await supabase
        .from('companies')
        .select('google_spreadsheet_id, google_sheet_name')
        .eq('id', boss.company_id)
        .maybeSingle()

      const clearTarget = pending.payload.target as string

      if (clearTarget === 'month') {
        await supabase.from('work_logs').delete().eq('company_id', boss.company_id)
        await clearAllSheets(supabase as any, boss.company_id, company?.google_sheet_name ?? 'Registros')
        await sendWhatsAppText(fromPhone, '🗑️ Mes borrado correctamente.\nTodas las hojas fueron limpiadas.')
      } else {
        const weekNum = Number(clearTarget.replace('week_', ''))

        const now = new Date()
        const year = now.getFullYear()
        const month = now.getMonth()
        const firstOfMonth = new Date(year, month, 1)
        const firstDow = (firstOfMonth.getDay() + 6) % 7

        const weekStartDay = (weekNum - 1) * 7 - firstDow + 1
        const startDay = Math.max(weekStartDay, 1)
        const endDay = startDay + 6
        const lastOfMonth = new Date(year, month + 1, 0).getDate()

        const startDate = `${year}-${pad2(month + 1)}-${pad2(startDay)}`
        const endDate = `${year}-${pad2(month + 1)}-${pad2(Math.min(endDay, lastOfMonth))}`

        await supabase
          .from('work_logs')
          .delete()
          .eq('company_id', boss.company_id)
          .gte('date', startDate)
          .lte('date', endDate)

        await clearWeekSheet(supabase as any, boss.company_id, weekNum)
        await sendWhatsAppText(fromPhone, `🗑️ Semana ${weekNum} borrada correctamente.`)
      }

      await supabase.from("pending_actions").delete().eq("id", pending.id)
    } else {
      // text === "2"
      await supabase.from("pending_actions").delete().eq("id", pending.id)
      await sendWhatsAppText(fromPhone, '❌ Borrado cancelado.')
    }

    return new Response("ok")
  }

  // -------- VALIDAR JEFE --------
  const { data: boss } = await supabase
    .from('users')
    .select('id, company_id, name')
    .eq('phone_number', fromPhone)
    .maybeSingle()

  if (!boss) {
    await sendWhatsAppText(fromPhone, '⛔ Número no autorizado.')
    return new Response('ok')
  }

  console.log("BOSS RESUELTO:", boss.name, "| COMPANY_ID:", boss.company_id)

  // -------- PARSEAR MENSAJE --------
  const parsed = parseIncomingMessage(text)

  if (parsed.kind === 'error') {
    await sendWhatsAppText(fromPhone, `⛔ ${parsed.message}`)
    return new Response('ok')
  }

  // -------- EXPORTAR --------
  if (parsed.kind === 'export') {
    const { data: company } = await supabase
      .from('companies')
      .select('google_spreadsheet_id')
      .eq('id', boss.company_id)
      .maybeSingle()

    if (!company?.google_spreadsheet_id) {
      await sendWhatsAppText(fromPhone, '❌ No hay planilla configurada.')
      return new Response('ok')
    }

    const exportUrl = getExportUrl(company.google_spreadsheet_id)
    await sendWhatsAppText(fromPhone, `📥 Descargá el archivo Excel desde este link:\n${exportUrl}`)
    return new Response('ok')
  }

  // -------- BORRAR (con confirmación) --------
  if (parsed.kind === 'clear_month' || parsed.kind === 'clear_week') {
    const { data: company } = await supabase
      .from('companies')
      .select('google_spreadsheet_id')
      .eq('id', boss.company_id)
      .maybeSingle()

    const exportUrl = company?.google_spreadsheet_id
      ? getExportUrl(company.google_spreadsheet_id)
      : null

    const target = parsed.kind === 'clear_month' ? 'month' : `week_${parsed.weekNum}`
    const label = parsed.kind === 'clear_month' ? 'el mes completo' : `la Semana ${parsed.weekNum}`

    await supabase.from("pending_actions").delete().eq("phone", fromPhone)
    await supabase.from("pending_actions").insert({
      phone: fromPhone,
      company_id: boss.company_id,
      type: "confirm_clear",
      payload: { target }
    })

    const exportLine = exportUrl ? `\n\n📥 Antes de borrar, podés descargar el archivo:\n${exportUrl}` : ''
    await sendWhatsAppText(
      fromPhone,
      `⚠️ ¿Confirmás que querés borrar ${label}?\nEsto eliminará los registros de BD y del Sheet.${exportLine}\n\nRespondé:\n1️⃣ Confirmar\n2️⃣ Cancelar`
    )
    return new Response('ok')
  }

  // -------- TARIFA --------
  if (parsed.kind === 'set_rate') {
    const { data: allEmps } = await supabase
      .from('employees')
      .select('id, name')
      .eq('company_id', boss.company_id)
      .eq('active', true)

    const matches = (allEmps ?? []).filter(e => employeeMatchesQuery(e.name, parsed.employeeName))

    if (matches.length === 0) {
      await sendWhatsAppText(fromPhone, `No encontré al empleado "${parsed.employeeName}".`)
      return new Response('ok')
    }

    if (matches.length > 1) {
      const list = matches.map((e, i) => `${i + 1}. ${e.name}`).join("\n")
      await supabase.from("pending_actions").delete().eq("phone", fromPhone)
      await supabase.from("pending_actions").insert({
        phone: fromPhone,
        company_id: boss.company_id,
        type: "select_employee_for_rate",
        payload: { employees: matches.map(e => ({ id: e.id, name: e.name })), rate: parsed.hourlyRate }
      })
      await sendWhatsAppText(fromPhone, `⚠️ Encontré varios empleados:\n\n${list}\n\nResponde con el número del empleado.`)
      return new Response('ok')
    }

    await supabase
      .from('employees')
      .update({ hourly_rate: parsed.hourlyRate })
      .eq('id', matches[0].id)

    let sheetWarningT = ''
    try {
      await recalculateEmployeeWeeklyTotals(supabase as any, boss.company_id, matches[0].name, parsed.hourlyRate)
    } catch (e: any) {
      console.error("Error recalculando semanas:", e)
      sheetWarningT = `\n\n⚠️ Tarifa guardada en la base, pero no se pudieron recalcular las semanas en la planilla: ${e?.message ?? e}`
    }

    await sendWhatsAppText(
      fromPhone,
      `✅ Tarifa actualizada\nEmpleado: ${matches[0].name}\nValor hora: $${formatNumberES(parsed.hourlyRate)}${sheetWarningT}`
    )
    return new Response('ok')
  }

  // -------- LISTAR EMPLEADOS --------
  if (parsed.kind === "list_employees") {
    const { data: emps } = await supabase
      .from("employees")
      .select("name, hourly_rate")
      .eq("company_id", boss.company_id)
      .eq("active", true)
      .order("name")

    const list = emps?.length
      ? emps.map((e, i) => `${i + 1}. ${e.name}`).join("\n")
      : "No hay empleados activos."
    await sendWhatsAppText(fromPhone, `👷 Empleados activos\n\n${list}`)
    return new Response("ok")
  }

  // -------- LISTAR TARIFAS --------
  if (parsed.kind === "list_rates") {
    const { data: emps } = await supabase
      .from("employees")
      .select("name, hourly_rate")
      .eq("company_id", boss.company_id)
      .eq("active", true)
      .order("name")

    // hourly_rate default = 0 en DB; 0 lo tratamos como "sin tarifa".
    const list = emps?.length
      ? emps.map((e, i) => `${i + 1}. ${e.name} — ${e.hourly_rate ? `$${formatNumberES(e.hourly_rate)}` : 'sin tarifa'}`).join("\n")
      : "No hay empleados activos."
    await sendWhatsAppText(fromPhone, `💰 Tarifas\n\n${list}`)
    return new Response("ok")
  }

  // -------- ALTA EMPLEADO --------
  if (parsed.kind === "add_employee") {
    const name = parsed.employeeName.trim()
    // Comparación ignorando tildes y mayúsculas para no permitir duplicados tipo "Juan Perez" vs "Juan Pérez".
    const { data: allEmps } = await supabase
      .from("employees")
      .select("id, name, active")
      .eq("company_id", boss.company_id)

    const normalized = normalizeHumanText(name)
    const existing = (allEmps ?? []).find(e => normalizeHumanText(e.name) === normalized)

    if (existing) {
      if (!existing.active) {
        await supabase.from("employees").update({ active: true }).eq("id", existing.id)
        await sendWhatsAppText(fromPhone, `✅ Empleado reactivado:\n${existing.name}`)
      } else {
        await sendWhatsAppText(fromPhone, `⚠️ El empleado "${existing.name}" ya existe.`)
      }
    } else {
      await supabase.from("employees").insert({ company_id: boss.company_id, name, active: true })
      await sendWhatsAppText(fromPhone, `✅ Empleado creado:\n${name}`)
    }
    return new Response('ok')
  }

  // -------- BAJA EMPLEADO --------
  if (parsed.kind === "del_employee") {
    const name = parsed.employeeName.trim()
    const { data: allEmps } = await supabase
      .from("employees")
      .select("id, name, active")
      .eq("company_id", boss.company_id)

    const matches = (allEmps ?? []).filter(e => employeeMatchesQuery(e.name, name) && e.active)

    if (matches.length === 0) {
      await sendWhatsAppText(fromPhone, `No encontré al empleado "${name}".`)
      return new Response('ok')
    }

    if (matches.length > 1) {
      const list = matches.map((e, i) => `${i + 1}. ${e.name}`).join("\n")
      await sendWhatsAppText(fromPhone, `⚠️ Encontré varios empleados:\n\n${list}\n\nUsá el nombre completo para dar de baja.`)
      return new Response('ok')
    }

    await supabase.from("employees").update({ active: false }).eq("id", matches[0].id)
    await sendWhatsAppText(fromPhone, `✅ Empleado dado de baja:\n${matches[0].name}`)
    return new Response('ok')
  }

  // -------- REGISTRO DE HORAS --------
  const { data: allEmployees } = await supabase
    .from('employees')
    .select('id, name, active, hourly_rate')
    .eq('company_id', boss.company_id)
    .eq('active', true)

  const matches = (allEmployees ?? []).filter((e) => employeeMatchesQuery(e.name, parsed.employeeQuery))

  if (matches.length === 0) {
    await sendWhatsAppText(fromPhone, `No encontré al empleado "${parsed.employeeQuery}".`)
    return new Response('ok')
  }

  if (matches.length > 1) {
    const list = matches.map((e, i) => `${i + 1}. ${e.name}`).join("\n")
    await supabase.from("pending_actions").delete().eq("phone", fromPhone)
    await supabase.from("pending_actions").insert({
      phone: fromPhone,
      company_id: boss.company_id,
      type: "select_employee_for_worklog",
      payload: { employees: matches.map(e => ({ id: e.id, name: e.name })), workLog: parsed }
    })
    await sendWhatsAppText(fromPhone, `⚠️ Encontré varios empleados:\n\n${list}\n\nResponde con el número del empleado o su apellido.`)
    return new Response('ok')
  }

  const employee = matches[0]
  let finalHours = parsed.workedHours
  if (parsed.kind === "start_end") finalHours = computeHoursFromStartEnd(parsed.startTime, parsed.endTime)

  const safeDate = parsed.dateISO?.slice(0, 10)

  if (!safeDate) {
    await sendWhatsAppText(fromPhone, "❌ Fecha inválida")
    return new Response("ok")
  }

  const { data: existingLog } = await supabase
    .from('work_logs')
    .select('id, worked_hours')
    .eq('employee_id', employee.id)
    .eq('date', safeDate)
    .maybeSingle()

  const wasUpdate = !!existingLog

  const { error: upsertErr } = await supabase
    .from('work_logs')
    .upsert(
      {
        company_id: boss.company_id,
        employee_id: employee.id,
        date: safeDate,
        start_time: parsed.startTime ?? null,
        end_time: parsed.endTime ?? null,
        worked_hours: finalHours,
        boss_id: boss.id,
      },
      { onConflict: 'employee_id,date' }
    )
    .select()

  if (upsertErr) {
    console.error("ERROR UPSERT:", upsertErr)
    await sendWhatsAppText(fromPhone, `❌ Error guardando el registro.`)
    return new Response('ok')
  }

  const hourlyRate = employee.hourly_rate ?? 0

  const sheetPayload = {
    companyId: boss.company_id,
    employeeName: employee.name,
    bossName: boss.name,
    dateISO: parsed.dateISO,
    startTime: parsed.startTime ?? null,
    endTime: parsed.endTime ?? null,
    workedHours: finalHours
  }

  let sheetWarning = ''
  try {
    if (wasUpdate) {
      await updateWorkLogInSheet(supabase as any, sheetPayload)
      await updateWeeklySheetOnEdit(supabase as any, sheetPayload, hourlyRate, existingLog.worked_hours)
    } else {
      await appendWorkLogToCompanySheet(supabase as any, sheetPayload)
      await updateWeeklySheet(supabase as any, sheetPayload, hourlyRate)
    }
  } catch (e: any) {
    console.error("Error escribiendo en Sheet:", e)
    sheetWarning = `\n\n⚠️ Se guardó en la base, pero no se pudo actualizar la planilla: ${e?.message ?? e}`
  }

  const baseMsg = wasUpdate
    ? `✏️ Registro actualizado\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(parsed.dateISO)}\nAntes: ${formatNumberES(existingLog.worked_hours)}h → Ahora: ${formatNumberES(finalHours)}h`
    : `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${formatDateDDMMYYYY(parsed.dateISO)}\nHoras: ${formatNumberES(finalHours)}`

  await sendWhatsAppText(fromPhone, baseMsg + sheetWarning)

  return new Response('ok')
})