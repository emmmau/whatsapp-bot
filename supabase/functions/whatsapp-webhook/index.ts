import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseConfig, getWhatsAppConfig, normalizePhone } from '../_shared/config.js'
import { employeeMatchesQuery } from '../_shared/employeeMatch.js'
import { computeHoursFromStartEnd, parseIncomingMessage } from '../_shared/parser.js'
import { sendWhatsAppText } from '../_shared/whatsapp.js'
import {
  appendWorkLogToCompanySheet,
  updateWorkLogInSheet,
  updateWeeklySheet,
  updateWeeklySheetOnEdit,
  clearWeekSheet,
  clearAllSheets,
  getExportUrl
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

function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return ''
  const [yyyy, mm, dd] = isoDate.slice(0, 10).split('-')
  return `${dd}/${mm}/${yyyy}`
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
  let text = ""

  // -------- PROCESAR TEXTO O AUDIO --------
  if (msg.type === "text") {
    text = (msg.text?.body ?? '').trim()
  } else if (msg.type === "audio" && msg.audio?.id) {
    const transcription = await transcribeWhatsAppAudio(msg.audio.id)
    console.log("Audio transcripto:", transcription)
    text = await normalizeAudioWithAI(transcription)
    console.log("Audio normalizado:", text)
  }

  if (!text) return new Response('ok')
  console.log("Mensaje a procesar:", text)

  // -------- SELECCIÓN DE EMPLEADO O CONFIRMACIÓN (PENDING ACTIONS) --------
  if (/^\d+$/.test(text)) {
    const { data: pending } = await supabase
      .from("pending_actions")
      .select("*")
      .eq("phone", fromPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // ── Selección de empleado ──
    if (pending && pending.type === "select_employee_for_worklog") {
      const index = Number(text) - 1
      const employees = pending.payload.employees

      if (index < 0 || index >= employees.length) {
        await sendWhatsAppText(fromPhone, "Número inválido.")
        return new Response("ok")
      }

      const { data: boss } = await supabase
        .from('users')
        .select('id, company_id, name')
        .eq('phone_number', fromPhone)
        .maybeSingle()

      const employee = employees[index]
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

        if (wasUpdatePending) {
          await updateWorkLogInSheet(supabase as any, sheetPayload)
          await updateWeeklySheetOnEdit(supabase as any, sheetPayload, hourlyRate, existingLogPending.worked_hours)
        } else {
          await appendWorkLogToCompanySheet(supabase as any, sheetPayload)
          await updateWeeklySheet(supabase as any, sheetPayload, hourlyRate)
        }
      }

      const msgPending = wasUpdatePending
        ? `✏️ Registro actualizado\nEmpleado: ${employee.name}\nFecha: ${formatDate(workLog.dateISO)}\nAntes: ${existingLogPending.worked_hours}h → Ahora: ${workedHours}h`
        : `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${formatDate(workLog.dateISO)}\nHoras: ${workedHours}`

      await sendWhatsAppText(fromPhone, msgPending)
      return new Response("ok")
    }

    // ── Confirmación de borrado ──
    if (pending && pending.type === "confirm_clear") {
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

          // Calcular rango de fechas de esa semana en el mes actual
          const now = new Date()
          const year = now.getFullYear()
          const month = now.getMonth()
          const firstOfMonth = new Date(year, month, 1)
          const firstDow = (firstOfMonth.getDay() + 6) % 7 // lunes=0

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

      } else if (text === "2") {
        await supabase.from("pending_actions").delete().eq("id", pending.id)
        await sendWhatsAppText(fromPhone, '❌ Borrado cancelado.')
      } else {
        await sendWhatsAppText(fromPhone, 'Respondé 1 para confirmar o 2 para cancelar.')
      }

      return new Response("ok")
    }
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
      const list = matches.map((e, i) => `${i + 1}️⃣ ${e.name}`).join("\n")
      await sendWhatsAppText(fromPhone, `⚠️ Encontré varios empleados:\n\n${list}\n\nUsá el nombre completo para fijar la tarifa.`)
      return new Response('ok')
    }

    await supabase
      .from('employees')
      .update({ hourly_rate: parsed.hourlyRate })
      .eq('id', matches[0].id)

    await sendWhatsAppText(fromPhone, `✅ Tarifa actualizada\nEmpleado: ${matches[0].name}\nValor hora: $${parsed.hourlyRate}`)
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
    ? emps.map((e, i) => `${i + 1}️⃣ ${e.name}`).join("\n")
    : "No hay empleados activos."
    await sendWhatsAppText(fromPhone, `👷 Empleados activos\n\n${list}`)
    return new Response("ok")
  }

  // -------- ALTA EMPLEADO --------
  if (parsed.kind === "add_employee") {
    const name = parsed.employeeName.trim()
    const { data: emp } = await supabase
      .from("employees")
      .select("id, active")
      .eq("company_id", boss.company_id)
      .ilike("name", name)
      .maybeSingle()

    if (emp) {
      if (!emp.active) await supabase.from("employees").update({ active: true }).eq("id", emp.id)
      await sendWhatsAppText(fromPhone, emp.active ? `⚠️ El empleado "${name}" ya existe.` : `✅ Empleado reactivado:\n${name}`)
    } else {
      await supabase.from("employees").insert({ company_id: boss.company_id, name, active: true })
      await sendWhatsAppText(fromPhone, `✅ Empleado creado:\n${name}`)
    }
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
    const list = matches.map((e, i) => `${i + 1}️⃣ ${e.name}`).join("\n")
    await supabase.from("pending_actions").delete().eq("phone", fromPhone)
    await supabase.from("pending_actions").insert({
      phone: fromPhone,
      company_id: boss.company_id,
      type: "select_employee_for_worklog",
      payload: { employees: matches.map(e => ({ id: e.id, name: e.name })), workLog: parsed }
    })
    await sendWhatsAppText(fromPhone, `⚠️ Encontré varios empleados:\n\n${list}\n\nResponde con el número del empleado.`)
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

  if (wasUpdate) {
    await updateWorkLogInSheet(supabase as any, sheetPayload)
    await updateWeeklySheetOnEdit(supabase as any, sheetPayload, hourlyRate, existingLog.worked_hours)
    await sendWhatsAppText(
      fromPhone,
      `✏️ Registro actualizado\nEmpleado: ${employee.name}\nFecha: ${formatDate(parsed.dateISO)}\nAntes: ${existingLog.worked_hours}h → Ahora: ${finalHours}h`
    )
  } else {
    await appendWorkLogToCompanySheet(supabase as any, sheetPayload)
    await updateWeeklySheet(supabase as any, sheetPayload, hourlyRate)
    await sendWhatsAppText(
      fromPhone,
      `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${formatDate(parsed.dateISO)}\nHoras: ${finalHours}`
    )
  }

  return new Response('ok')
})