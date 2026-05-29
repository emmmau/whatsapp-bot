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

const HORAS_EXAMPLE =
  'Ejemplo:\nHORAS\nEmpleado: Juan Pérez\nFecha: 02/03/2026\nEntrada: 09:00\nSalida: 18:00\n\nO simplemente:\nJuan Pérez 8'

export function parseIncomingMessage(text) {
  const raw = text.trim()
  if (!raw) return { kind: 'error', message: 'Mensaje vacío.' }

  const s = raw.replace(/\t/g, ' ').replace(/\r/g, '').trim()
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean)

  if (lines.length > 0) {
    // Primera palabra (no la línea entera) para detectar la categoría.
    // Permite "ALTA Juan Perez", "TARIFA Juan Perez 1500", etc. inline.
    const firstWord = lines[0].toUpperCase().split(/\s+/)[0]
    const supportedCategory = ['HORAS', 'ALTA', 'BAJA', 'EMPLEADOS', 'EXPORTAR', 'BORRAR', 'TARIFA', 'TARIFAS']

    if (supportedCategory.includes(firstWord)) {
      const category = firstWord
      const bodyLines = lines.slice(1)

      // ── EXPORTAR ──────────────────────────────────────────────
      if (category === 'EXPORTAR') {
        return { kind: 'export' }
      }

      // ── BORRAR ────────────────────────────────────────────────
      // Soporta: "BORRAR MES", "BORRAR SEMANA 1", etc. (en una o dos líneas)
      const borrarInline = raw.match(/^BORRAR\s+(.+)$/i)
      if (category === 'BORRAR' && borrarInline) {
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
        if (tarifaOneLine) {
          return {
            kind: 'set_rate',
            employeeName: tarifaOneLine[1].trim(),
            hourlyRate: Number(tarifaOneLine[2].replace(',', '.'))
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
          message: 'Formato inválido.\nEj: TARIFA Juan Perez 1500\nO:\nTARIFA\nJuan Perez 1500'
        }
      }

      // ── EMPLEADOS / TARIFAS ───────────────────────────────────
      if (category === 'EMPLEADOS') return { kind: 'list_employees' }
      if (category === 'TARIFAS') return { kind: 'list_rates' }

      // ── ALTA ──────────────────────────────────────────────────
      if (category === 'ALTA') {
        const altaInline = raw.match(/^ALTA\s+(.+)$/i)
        if (altaInline) return { kind: 'add_employee', employeeName: altaInline[1].trim() }
        if (bodyLines.length === 0) return { kind: 'error', message: 'Debes indicar el nombre del empleado.\nEj: ALTA Juan Pérez' }
        return { kind: 'add_employee', employeeName: bodyLines[0].trim() }
      }

      // ── BAJA ──────────────────────────────────────────────────
      if (category === 'BAJA') {
        const bajaInline = raw.match(/^BAJA\s+(.+)$/i)
        if (bajaInline) return { kind: 'del_employee', employeeName: bajaInline[1].trim() }
        if (bodyLines.length === 0) return { kind: 'error', message: 'Debes indicar el nombre del empleado.\nEj: BAJA Juan Pérez' }
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
              return { kind: 'error', message: `Formato inválido.\n${HORAS_EXAMPLE}` }
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

        // Variante sin etiquetas — extraer fecha en cualquier posición primero,
        // y el resto en orden: nombre, [entrada, salida] o nombre, horas.
        const seq = [...bodyLines]
        let dateISO = todayISO()
        for (let i = 0; i < seq.length; i++) {
          const parsed = parseDateToISO(seq[i])
          if (parsed) {
            dateISO = parsed
            seq.splice(i, 1)
            break
          }
        }

        if (seq.length >= 3) {
          const employeeQuery = seq[0]
          const startTime = normalizeTime(seq[1])
          const endTime = normalizeTime(seq[2])
          if (startTime && endTime) return { kind: 'start_end', employeeQuery, dateISO, startTime, endTime }
        }

        if (seq.length >= 2) {
          const employeeQuery = seq[0]
          const workedHours = parseWorkedHours(seq[1])
          if (workedHours != null) return { kind: 'hours_only', employeeQuery, dateISO, workedHours }
        }

        return { kind: 'error', message: `No pude interpretar el bloque HORAS.\n\n${HORAS_EXAMPLE}` }
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

  // Detectar fecha en cualquier formato (dd/mm/yyyy o yyyy-mm-dd) en la línea
  let dateInLine = oneLine.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)
  if (!dateInLine) {
    dateInLine = oneLine.match(/\b(\d{4}-\d{1,2}-\d{1,2})\b/)
  }
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
  // Acepta sufijo opcional "h"/"hs"/"hora"/"horas" después del número.
  // El nombre NO puede contener dígitos — así "Juan 9 17" NO matchea (sería
  // nombre="Juan 9", horas=17) y cae a start_end como debe.
  const reHoursOnly = /^([^\d]+?)[,\s]+(\d+(?:[.,]\d+)?)\s*(?:h|hs|hora|horas)?$/i

  // Probamos hours_only ANTES que start_end para que "Juan 8,5" no se interprete
  // como start=8, end=5 (overnight 21h).
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
