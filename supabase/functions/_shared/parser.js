function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseDateToISO(input) {
  const s = input.trim()

  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) {
    const dd = Number(m1[1])
    const mm = Number(m1[2])
    const yyyy = Number(m1[3])
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yyyy}-${pad2(mm)}-${pad2(dd)}`
    }
  }

  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m2) {
    const yyyy = Number(m2[1])
    const mm = Number(m2[2])
    const dd = Number(m2[3])
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yyyy}-${pad2(mm)}-${pad2(dd)}`
    }
  }

  return null
}

function normalizeTime(input) {
  const s = input.trim()
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (!m) return null

  const hh = Number(m[1])
  const mm = m[2] ? Number(m[2]) : 0

  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null

  return `${pad2(hh)}:${pad2(mm)}`
}

function parseWorkedHours(input) {
  const s = input.trim().toLowerCase()
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(h|hs|hora|horas|)$/)
  if (!m) return null

  const raw = m[1].replace(',', '.')
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null

  return n
}

export function computeHoursFromStartEnd(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)

  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em

  let diff = endMin - startMin
  if (diff < 0) diff += 24 * 60

  return Math.round((diff / 60) * 100) / 100
}

export function parseMultipleWorkLogs(text) {
  const logs = []
  const lines = text.split(/\n|,/).map(l => l.trim()).filter(Boolean)

  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue

    const employeeName = parts.slice(0, parts.length - 1).join(" ")
    const last = parts[parts.length - 1]

    if (/^\d+(\.\d+)?$/.test(last)) {
      logs.push({
        employeeName,
        workedHours: Number(last),
        dateISO: new Date().toISOString().slice(0, 10)
      })
      continue
    }

    if (parts.length >= 3) {
      const start = parts[parts.length - 2]
      const end = parts[parts.length - 1]

      if (/^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end)) {
        const name = parts.slice(0, parts.length - 2).join(" ")
        logs.push({
          employeeName: name,
          startTime: start,
          endTime: end,
          dateISO: new Date().toISOString().slice(0, 10)
        })
      }
    }
  }

  return logs
}

export function parseIncomingMessage(text) {
  const raw = text.trim()
  if (!raw) return { kind: 'error', message: 'Mensaje vacío.' }

  const s = raw.replace(/\t/g, ' ').replace(/\r/g, '').trim()
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean)

  if (lines.length > 0) {
    const firstLine = lines[0].toUpperCase()
    const supportedCategory = ['HORAS', 'ALTA', 'BAJA', 'EMPLEADOS', 'EXPORTAR', 'BORRAR', 'TARIFA']

    if (supportedCategory.includes(firstLine) || firstLine.startsWith('BORRAR')) {

      const category = firstLine
      const bodyLines = lines.slice(1)

      // ── EXPORTAR ──────────────────────────────────────────────
      if (category === 'EXPORTAR') {
        return { kind: 'export' }
      }

      // ── BORRAR ────────────────────────────────────────────────
      // Soporta: "BORRAR MES", "BORRAR SEMANA 1", etc. (en una o dos líneas)
      const borrarInline = raw.match(/^BORRAR\s+(.+)$/i)
      if (borrarInline) {
        const what = borrarInline[1].trim().toUpperCase()
        if (what === 'MES') return { kind: 'clear_month' }

        const semMatch = what.match(/^SEMANA\s+([1-4])$/)
        if (semMatch) return { kind: 'clear_week', weekNum: Number(semMatch[1]) }

        return { kind: 'error', message: 'Comando inválido. Usá:\nBORRAR MES\nBORRAR SEMANA 1 (o 2, 3, 4)' }
      }

      // ── TARIFA ────────────────────────────────────────────────
      // Soporta: "TARIFA\nJuan Perez 1500" o "TARIFA Juan Perez 1500"
      if (category === 'TARIFA') {
        const tarifaOneLine = s.match(/^TARIFA\s+(.+)\s+(\d+(?:[.,]\d+)?)$/i)
        if (tarifaInline) {
          return {
            kind: 'set_rate',
            employeeName: tarifaInline[1].trim(),
            hourlyRate: Number(tarifaInline[2].replace(',', '.'))
          }
        }

        if (bodyLines.length >= 1) {
          const bodyLine = bodyLines[0]
          const m = bodyLine.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/)
          if (m) {
            return {
              kind: 'set_rate',
              employeeName: m[1].trim(),
              hourlyRate: Number(m[2].replace(',', '.'))
            }
          }
        }

        return {
          kind: 'error',
          message: 'Formato inválido.\nEj: TARIFA\nJuan Perez 1500'
        }
      }

      // ── EMPLEADOS ─────────────────────────────────────────────
      if (category === 'EMPLEADOS') {
        return { kind: 'list_employees' }
      }

      // ── ALTA ──────────────────────────────────────────────────
      if (category === 'ALTA') {
        const altaInline = raw.match(/^ALTA\s+(.+)$/i)
        if (altaInline) return { kind: 'add_employee', employeeName: altaInline[1].trim() }
        if (bodyLines.length === 0) return { kind: 'error', message: 'Debes indicar el nombre del empleado.\nEj: ALTA\nJuan Pérez' }
        return { kind: 'add_employee', employeeName: bodyLines[0].trim() }
      }

      // ── BAJA ──────────────────────────────────────────────────
      if (category === 'BAJA') {
        const bajaInline = raw.match(/^BAJA\s+(.+)$/i)
        if (bajaInline) return { kind: 'del_employee', employeeName: bajaInline[1].trim() }
        if (bodyLines.length === 0) return { kind: 'error', message: 'Debes indicar el nombre del empleado.\nEj: BAJA\nJuan Pérez' }
        return { kind: 'del_employee', employeeName: bodyLines[0].trim() }
      }

      // ── HORAS ─────────────────────────────────────────────────
      if (category === 'HORAS') {
        const labelMap = {}
        for (const ln of bodyLines) {
          const m = ln.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s*:\s*(.+)$/)
          if (m) labelMap[m[1].toLowerCase()] = m[2].trim()
        }

        const hasLabeled = 'empleado' in labelMap || 'fecha' in labelMap || 'entrada' in labelMap || 'salida' in labelMap

        if (hasLabeled) {
          const employeeQuery = (labelMap['empleado'] || '').trim()
          const dateRaw = (labelMap['fecha'] || '').trim()
          const startRaw = (labelMap['entrada'] || '').trim()
          const endRaw = (labelMap['salida'] || '').trim()

          if (employeeQuery && (startRaw || endRaw)) {
            const startTime = normalizeTime(startRaw)
            const endTime = normalizeTime(endRaw)
            if (!startTime || !endTime) {
              return { kind: 'error', message: 'Formato inválido. Ej: "HORAS\\nEmpleado: Juan Pérez\\nFecha: 02/03/2026\\nEntrada: 09:00\\nSalida: 18:00"' }
            }
            let dateISO = todayISO()
            if (dateRaw) {
              const parsed = parseDateToISO(dateRaw)
              if (!parsed) return { kind: 'error', message: 'Fecha inválida. Usa "dd/mm/yyyy" o "yyyy-mm-dd".' }
              dateISO = parsed
            }
            return { kind: 'start_end', employeeQuery, dateISO, startTime, endTime }
          }

          if (employeeQuery && ('horas' in labelMap || 'worked' in labelMap)) {
            const hoursRaw = (labelMap['horas'] || labelMap['worked'] || '').trim()
            const workedHours = parseWorkedHours(hoursRaw)
            if (workedHours == null) return { kind: 'error', message: 'Horas inválidas. Ej: "HORAS\\nEmpleado: Juan Pérez\\nHoras: 9".' }
            const dateISO = dateRaw ? (parseDateToISO(dateRaw) || todayISO()) : todayISO()
            return { kind: 'hours_only', employeeQuery, dateISO, workedHours }
          }
        }

        // Variante B sin etiquetas
        const seq = bodyLines

        if (seq.length >= 4) {
          const employeeQuery = seq[0]
          const dateISO = parseDateToISO(seq[1])
          const startTime = normalizeTime(seq[2])
          const endTime = normalizeTime(seq[3])
          if (dateISO && startTime && endTime) return { kind: 'start_end', employeeQuery, dateISO, startTime, endTime }
        }

        if (seq.length >= 3) {
          const employeeQuery = seq[0]
          const startTime = normalizeTime(seq[1])
          const endTime = normalizeTime(seq[2])
          if (startTime && endTime) return { kind: 'start_end', employeeQuery, dateISO: todayISO(), startTime, endTime }
        }

        if (seq.length >= 2) {
          const employeeQuery = seq[0]
          const workedHours = parseWorkedHours(seq[1])
          if (workedHours != null) return { kind: 'hours_only', employeeQuery, dateISO: todayISO(), workedHours }
        }

        return { kind: 'error', message: 'No pude interpretar el bloque HORAS' }
      }
    }
  }

  // ── TARIFA inline (una sola línea, cualquier capitalización) ──
const tarifaOneLine = s.match(/^TARIFA\s+(.+)\s+(\d+(?:[.,]\d+)?)$/i)
if (tarifaOneLine) {
  return {
    kind: 'set_rate',
    employeeName: tarifaOneLine[1].trim(),
    hourlyRate: Number(tarifaOneLine[2].replace(',', '.'))
  }
}

// FORMATO SIMPLE UNA LINEA
const oneLine = s.replace(/[ \t]+/g, ' ').trim()

// Intentar detectar fecha en la línea (dd/mm/yyyy)
const dateInLine = oneLine.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)
let lineWithoutDate = oneLine
let extractedDateISO = todayISO()

if (dateInLine) {
  const parsedDate = parseDateToISO(dateInLine[1])
  if (parsedDate) {
    extractedDateISO = parsedDate
    lineWithoutDate = oneLine.replace(dateInLine[0], '').replace(/[,\s]+/g, ' ').trim()
  }
}

const reStartEnd = /^(.+?)[,\s]+(\d{1,2}(?::\d{2})?)[,\s]+(\d{1,2}(?::\d{2})?)$/i
const reHoursOnly = /^(.+?)[,\s]+(\d+(?:[.,]\d+)?)$/i

const m1 = lineWithoutDate.match(reStartEnd)
if (m1) {
  const employeeQuery = m1[1].trim()
  const startTime = normalizeTime(m1[2])
  const endTime = normalizeTime(m1[3])
  if (startTime && endTime) {
    return {
      kind: 'start_end',
      employeeQuery,
      dateISO: extractedDateISO,
      startTime,
      endTime
    }
  }
}

const m2 = lineWithoutDate.match(reHoursOnly)
if (m2) {
  const employeeQuery = m2[1].trim()
  const workedHours = parseWorkedHours(m2[2])
  if (workedHours != null) {
    return {
      kind: 'hours_only',
      employeeQuery,
      dateISO: extractedDateISO,
      workedHours
    }
  }
}

return {
  kind: 'error',
  message: 'No pude interpretar el mensaje.'
}
}

export {
  parseWorkedHours,
  normalizeTime,
  parseDateToISO,
  todayISO
}