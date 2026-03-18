import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSupabaseConfig, getWhatsAppConfig, normalizePhone } from '../_shared/config.js'
import { employeeMatchesQuery } from '../_shared/employeeMatch.js'
import { computeHoursFromStartEnd, parseIncomingMessage } from '../_shared/parser.js'
import { sendWhatsAppText } from '../_shared/whatsapp.js'
import { appendWorkLogToCompanySheet } from '../_shared/googleSheets.js'
import { transcribeWhatsAppAudio } from '../_shared/audio.js'

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
    // 🔒 IDMPOTENCIA REAL
    const { data: alreadyProcessed } = await supabase
      .from('processed_messages')
      .select('id')
      .eq('message_id', msg.id)
      .maybeSingle()
    
    if (alreadyProcessed) {
      console.log("Mensaje duplicado ignorado:", msg.id)
      return new Response('ok')
    }
    
    // 👉 marcar como procesado INMEDIATAMENTE
    await supabase.from('processed_messages').insert({
      message_id: msg.id
    })

  const fromPhone = normalizePhone(msg.from)
  let text = ""

  // -------- PROCESAR TEXTO O AUDIO --------
  if (msg.type === "text") {
    text = (msg.text?.body ?? '').trim()
  } else if (msg.type === "audio" && msg.audio?.id) {
    text = await transcribeWhatsAppAudio(msg.audio.id)
    console.log("Audio transcripto:", text)
  }

  if (!text) return new Response('ok')
  console.log("Mensaje a procesar:", text)

  // -------- SELECCIÓN DE EMPLEADO POR NÚMERO (PENDING ACTIONS) --------
  if (/^\d+$/.test(text)) {
    const { data: pending } = await supabase
      .from("pending_actions")
      .select("*")
      .eq("phone", fromPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

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
    {
      onConflict: 'employee_id,date'
    }
  )

      await supabase.from("pending_actions").delete().eq("id", pending.id)

      if (boss) {
        await appendWorkLogToCompanySheet(supabase as any, {
          companyId: boss.company_id,
          employeeName: employee.name,
          bossName: boss.name,
          dateISO: workLog.dateISO,
          startTime: workLog.startTime ?? null,
          endTime: workLog.endTime ?? null,
          workedHours: workedHours
        })
      }
    
      await sendWhatsAppText(fromPhone, `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${workLog.dateISO}\nHoras: ${workedHours}`)
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

  // -------- COMANDOS (LISTAR, ALTA, BAJA) --------
  if (parsed.kind === "list_employees") {
    const { data: emps } = await supabase
      .from("employees")
      .select("name")
      .eq("company_id", boss.company_id)
      .eq("active", true)
      .order("name")

    const list = emps?.length ? emps.map((e, i) => `${i + 1}️⃣ ${e.name}`).join("\n") : "No hay empleados activos."
    await sendWhatsAppText(fromPhone, `👷 Empleados activos\n\n${list}`)
    return new Response("ok")
  }

  if (parsed.kind === "add_employee") {
    const name = parsed.employeeName.trim()
    const { data: emp } = await supabase.from("employees").select("id, active").eq("company_id", boss.company_id).ilike("name", name).maybeSingle()

    if (emp) {
      if (!emp.active) await supabase.from("employees").update({ active: true }).eq("id", emp.id)
      await sendWhatsAppText(fromPhone, emp.active ? `⚠️ El empleado "${name}" ya existe.` : `✅ Empleado reactivado:\n${name}`)
    } else {
      await supabase.from("employees").insert({ company_id: boss.company_id, name, active: true })
      await sendWhatsAppText(fromPhone, `✅ Empleado creado:\n${name}`)
    }
    return new Response('ok')
  }

  // -------- REGISTRO DE HORAS NORMAL --------
  const { data: allEmployees } = await supabase
    .from('employees')
    .select('id, name, active')
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

    const { data, error: upsertErr } = await supabase
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
        {
          onConflict: 'employee_id,date'
        }
      )
      .select()
  
  if (upsertErr) {
  
    console.error("ERROR UPSERT:", upsertErr)
  
    await sendWhatsAppText(
      fromPhone,
      `✅ Horas registradas/actualizadas\nEmpleado: ${employee.name}\nFecha: ${parsed.dateISO}\nHoras: ${finalHours}`
    )
  
    return new Response('ok')
  }

  await appendWorkLogToCompanySheet(supabase as any, {
    companyId: boss.company_id,
    employeeName: employee.name,
    bossName: boss.name,
    dateISO: parsed.dateISO,
    startTime: parsed.startTime ?? null,
    endTime: parsed.endTime ?? null,
    workedHours: finalHours
  })

  await sendWhatsAppText(fromPhone, `✅ Horas registradas\nEmpleado: ${employee.name}\nFecha: ${parsed.dateISO}\nHoras: ${finalHours}`)
  return new Response('ok')
})