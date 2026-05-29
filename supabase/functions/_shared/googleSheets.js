import { formatDateDDMMYYYY, formatNumberES } from './text.js'

async function getGoogleAccessToken() {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var missing")

  const serviceAccount = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)

  const header = { alg: "RS256", typ: "JWT" }
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }

  const encoder = new TextEncoder()
  const base64 = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  const header64 = base64(header)
  const payload64 = base64(payload)
  const data = `${header64}.${payload64}`

  const key = await crypto.subtle.importKey(
    "pkcs8",
    str2ab(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  )

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(data))

  const jwt =
    `${data}.` +
    btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })

  const json = await res.json()
  return json.access_token
}

function str2ab(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "")
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Devuelve el número de semana del mes (1-4) según lunes-domingo calendario real.
 * Semana 1 = la semana que contiene el día 1 del mes.
 */
export function getWeekOfMonth(dateISO) {
  const date = new Date(dateISO + "T00:00:00")
  const year = date.getFullYear()
  const month = date.getMonth()

  // Primer lunes que cae EN el mes (puede ser el día 1 si es lunes,
  // o el primer lunes posterior al día 1)
  const firstOfMonth = new Date(year, month, 1)
  const firstDow = (firstOfMonth.getDay() + 6) % 7 // lunes=0

  // Si el mes empieza en lunes (firstDow=0), la semana 1 arranca el día 1
  // Si empieza martes-domingo, la semana 1 arranca el lunes siguiente
  const firstMondayDay = firstDow === 0 ? 1 : 1 + (7 - firstDow)
  const firstMonday = new Date(year, month, firstMondayDay)

  // Si la fecha es antes del primer lunes del mes → semana 1 igual
  if (date < firstMonday) return 1

  const diffDays = Math.floor((date.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24))
  const weekNum = Math.floor(diffDays / 7) + 1

  return Math.min(weekNum, 4)
}

function parseSheetError(body, sheetName) {
  try {
    const j = JSON.parse(body)
    const msg = j?.error?.message ?? body
    if (/unable to parse range/i.test(msg)) {
      return `la pestaña "${sheetName}" no existe en el spreadsheet`
    }
    if (/permission/i.test(msg) || /forbidden/i.test(msg)) {
      return `el service account no tiene permiso de Editor sobre el spreadsheet`
    }
    return msg
  } catch {
    return body
  }
}

async function readSheet(token, spreadsheetId, sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A:Z`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    const body = await res.text()
    console.error("Error leyendo sheet:", body)
    throw new Error(parseSheetError(body, sheetName))
  }
  const data = await res.json()
  return data.values ?? []
}

async function writeRow(token, spreadsheetId, sheetName, rowIndex, values) {
  const sheetsRow = rowIndex + 1 // 1-based
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A${sheetsRow}:Z${sheetsRow}?valueInputOption=USER_ENTERED`

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [values] })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("Error escribiendo fila:", body)
    throw new Error(parseSheetError(body, sheetName))
  }
}

async function appendRow(token, spreadsheetId, sheetName, values) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A:Z:append?valueInputOption=USER_ENTERED`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [values] })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("Error en append:", body)
    throw new Error(parseSheetError(body, sheetName))
  }
}

// ─── Funciones principales ───────────────────────────────────────────────────

export async function appendWorkLogToCompanySheet(supabase, workLog) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("name, google_spreadsheet_id, google_sheet_name")
    .eq("id", workLog.companyId)
    .maybeSingle()

  if (!company) return

  // El apóstrofe al principio fuerza a Sheets a guardar la celda como texto
  // (sin parsear como fecha y mostrarla con el formato automático yyyy-mm-dd).
  const row = [
    `'${formatDateDDMMYYYY(workLog.dateISO)}`,
    workLog.employeeName,
    workLog.startTime ?? "",
    workLog.endTime ?? "",
    formatNumberES(workLog.workedHours),
    workLog.bossName,
    company.name
  ]

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${company.google_spreadsheet_id}` +
    `/values/${encodeURIComponent(company.google_sheet_name)}!A:G:append?valueInputOption=USER_ENTERED`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [row] })
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("Google Sheets error:", body)
    throw new Error(parseSheetError(body, company.google_sheet_name))
  }
}

export async function updateWorkLogInSheet(supabase, workLog) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("name, google_spreadsheet_id, google_sheet_name")
    .eq("id", workLog.companyId)
    .maybeSingle()

  if (!company) return

  const rows = await readSheet(token, company.google_spreadsheet_id, company.google_sheet_name)

  // La fila puede haberse escrito en dd/mm/yyyy (formato nuevo) o yyyy-mm-dd
  // (filas legacy escritas antes del cambio de formato). Aceptamos ambos al buscar.
  const isoDate = workLog.dateISO?.slice(0, 10)
  const displayDate = formatDateDDMMYYYY(workLog.dateISO)

  let rowIndex = -1
  for (let i = 1; i < rows.length; i++) {
    const rowDate = (rows[i][0] ?? "").trim()
    const rowName = (rows[i][1] ?? "").trim().toLowerCase()
    const dateMatches = rowDate === displayDate || rowDate === isoDate
    if (dateMatches && rowName === workLog.employeeName.toLowerCase()) {
      rowIndex = i
      break
    }
  }

  const newRow = [
    `'${displayDate}`,
    workLog.employeeName,
    workLog.startTime ?? "",
    workLog.endTime ?? "",
    formatNumberES(workLog.workedHours),
    workLog.bossName,
    company.name
  ]

  if (rowIndex === -1) {
    console.warn("updateWorkLogInSheet: fila no encontrada, haciendo append")
    await appendWorkLogToCompanySheet(supabase, workLog)
    return
  }

  await writeRow(token, company.google_spreadsheet_id, company.google_sheet_name, rowIndex, newRow)
}

/**
 * Actualiza la hoja de semana correspondiente a la fecha del workLog.
 * - Si el empleado ya tiene fila en esa semana → suma las horas y recalcula total
 * - Si no existe → agrega fila nueva
 */
export async function updateWeeklySheet(supabase, workLog, hourlyRate) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("google_spreadsheet_id")
    .eq("id", workLog.companyId)
    .maybeSingle()

  if (!company) return

  const weekNum = getWeekOfMonth(workLog.dateISO)
  const sheetName = `Semana ${weekNum}`
  const spreadsheetId = company.google_spreadsheet_id

  const rows = await readSheet(token, spreadsheetId, sheetName)

  // Buscar empleado en la hoja (col A = Nombre), saltando header (fila 0)
  let rowIndex = -1
  for (let i = 1; i < rows.length; i++) {
    const rowName = (rows[i][0] ?? "").trim().toLowerCase()
    if (rowName === workLog.employeeName.toLowerCase()) {
      rowIndex = i
      break
    }
  }

  if (rowIndex !== -1) {
    // Empleado ya existe — sumar horas.
    // Re-parsear el valor de la celda (puede estar guardado como "1500,50" o "1500.5").
    const prevHours = parseFloat(String(rows[rowIndex][1] ?? "0").replace(',', '.')) || 0
    const newHours = Math.round((prevHours + workLog.workedHours) * 100) / 100
    const total = Math.round(newHours * hourlyRate * 100) / 100

    await writeRow(token, spreadsheetId, sheetName, rowIndex, [
      workLog.employeeName,
      formatNumberES(newHours),
      formatNumberES(hourlyRate),
      formatNumberES(total)
    ])
  } else {
    // Empleado nuevo en esta semana — append
    const total = Math.round(workLog.workedHours * hourlyRate * 100) / 100
    await appendRow(token, spreadsheetId, sheetName, [
      workLog.employeeName,
      formatNumberES(workLog.workedHours),
      formatNumberES(hourlyRate),
      formatNumberES(total)
    ])
  }
}

/**
 * Cuando se actualiza un work_log existente, hay que restar las horas viejas
 * y sumar las nuevas en la hoja de semana.
 */
export async function updateWeeklySheetOnEdit(supabase, workLog, hourlyRate, previousHours) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("google_spreadsheet_id")
    .eq("id", workLog.companyId)
    .maybeSingle()

  if (!company) return

  const weekNum = getWeekOfMonth(workLog.dateISO)
  const sheetName = `Semana ${weekNum}`
  const spreadsheetId = company.google_spreadsheet_id

  const rows = await readSheet(token, spreadsheetId, sheetName)

  let rowIndex = -1
  for (let i = 1; i < rows.length; i++) {
    const rowName = (rows[i][0] ?? "").trim().toLowerCase()
    if (rowName === workLog.employeeName.toLowerCase()) {
      rowIndex = i
      break
    }
  }

  if (rowIndex === -1) {
    // No estaba en la semana — tratar como nuevo
    await updateWeeklySheet(supabase, workLog, hourlyRate)
    return
  }

  const prevAccumulated = parseFloat(String(rows[rowIndex][1] ?? "0").replace(',', '.')) || 0
  // Restar horas viejas, sumar nuevas
  const newHours = Math.max(
    Math.round((prevAccumulated - previousHours + workLog.workedHours) * 100) / 100,
    0
  )
  const total = Math.round(newHours * hourlyRate * 100) / 100

  await writeRow(token, spreadsheetId, sheetName, rowIndex, [
    workLog.employeeName,
    formatNumberES(newHours),
    formatNumberES(hourlyRate),
    formatNumberES(total)
  ])
}

/**
 * Limpia una hoja de semana dejando solo el header.
 */
export async function clearWeekSheet(supabase, companyId, weekNum) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("google_spreadsheet_id")
    .eq("id", companyId)
    .maybeSingle()

  if (!company) return

  const sheetName = `Semana ${weekNum}`
  await _clearSheetKeepHeader(token, company.google_spreadsheet_id, sheetName)
}

/**
 * Limpia todas las hojas (Registros + 4 semanas) dejando solo headers.
 */
export async function clearAllSheets(supabase, companyId, mainSheetName) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("google_spreadsheet_id")
    .eq("id", companyId)
    .maybeSingle()

  if (!company) return

  const spreadsheetId = company.google_spreadsheet_id

  await _clearSheetKeepHeader(token, spreadsheetId, mainSheetName)
  for (let w = 1; w <= 4; w++) {
    await _clearSheetKeepHeader(token, spreadsheetId, `Semana ${w}`)
  }
}

async function _clearSheetKeepHeader(token, spreadsheetId, sheetName) {
  // Leer todas las filas para saber cuántas hay
  const rows = await readSheet(token, spreadsheetId, sheetName)
  if (rows.length <= 1) return // Solo header o vacío

  // Borrar desde fila 2 en adelante
  const lastRow = rows.length
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(sheetName)}!A2:Z${lastRow}:clear`

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) console.error(`Error limpiando ${sheetName}:`, await res.text())
}

/**
 * Devuelve la URL de descarga del spreadsheet como xlsx.
 */
export function getExportUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
}

/**
 * Cuando se cambia la tarifa de un empleado, recorrer las 4 hojas semanales
 * y recalcular Total = Horas × nuevaTarifa para ese empleado.
 */
export async function recalculateEmployeeWeeklyTotals(supabase, companyId, employeeName, newRate) {
  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("google_spreadsheet_id")
    .eq("id", companyId)
    .maybeSingle()

  if (!company?.google_spreadsheet_id) return

  const spreadsheetId = company.google_spreadsheet_id
  const targetName = employeeName.toLowerCase()

  for (let w = 1; w <= 4; w++) {
    const sheetName = `Semana ${w}`
    const rows = await readSheet(token, spreadsheetId, sheetName)

    let rowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      const rowName = (rows[i][0] ?? "").trim().toLowerCase()
      if (rowName === targetName) {
        rowIndex = i
        break
      }
    }

    if (rowIndex === -1) continue

    const hours = parseFloat(String(rows[rowIndex][1] ?? "0").replace(',', '.')) || 0
    const total = Math.round(hours * newRate * 100) / 100

    await writeRow(token, spreadsheetId, sheetName, rowIndex, [
      employeeName,
      formatNumberES(hours),
      formatNumberES(newRate),
      formatNumberES(total)
    ])
  }
}