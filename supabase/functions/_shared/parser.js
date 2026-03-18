function pad2(n) {
  return String(n).padStart(2, '0')
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function parseDateToISO(input) {
  const s = input.trim()

  // dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) {
    const dd = Number(m1[1])
    const mm = Number(m1[2])
    const yyyy = Number(m1[3])
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${yyyy}-${pad2(mm)}-${pad2(dd)}`
    }
  }

  // yyyy-mm-dd
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

function computeHoursFromStartEnd(startTime, endTime) {

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

  const lines = text
    .split(/\n|,/)
    .map(l => l.trim())
    .filter(Boolean)

  for (const line of lines) {

    const parts = line.split(/\s+/)

    if (parts.length < 2) {
      continue
    }

    const employeeName = parts.slice(0, parts.length - 1).join(" ")

    const last = parts[parts.length - 1]

    // horas tipo "9" o "3.5"
    if (/^\d+(\.\d+)?$/.test(last)) {

      logs.push({
        employeeName,
        workedHours: Number(last),
        dateISO: new Date().toISOString().slice(0, 10)
      })

      continue
    }

    // horario tipo "12:00 18:00"
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

function parseIncomingMessage(text) {

  const raw = text.trim()

  if (!raw) {
    return { kind: 'error', message: 'Mensaje vacío.' }
  }

  const s = raw.replace(/\t/g, ' ').replace(/\r/g, '').trim()

  const lines = s.split('\n').map(l => l.trim()).filter(Boolean)

  if (lines.length > 0) {

    const firstLine = lines[0].toUpperCase()

    const supportedCategory = ['HORAS', 'ALTA', 'BAJA', 'EMPLEADOS']

    if (supportedCategory.includes(firstLine)) {

      const category = firstLine
      const bodyLines = lines.slice(1)

      // LISTAR EMPLEADOS
      if (category === 'EMPLEADOS') {
        return { kind: "list_employees" }
      }

      // ALTA EMPLEADO
      if (category === 'ALTA') {

        const altaInline = raw.match(/^ALTA\s+(.+)$/i)

        if (altaInline) {
          return {
            kind: "add_employee",
            employeeName: altaInline[1].trim()
          }
        }

        if (bodyLines.length === 0) {
          return {
            kind: "error",
            message: "Debes indicar el nombre del empleado.\nEj: ALTA\nJuan Pérez"
          }
        }

        return {
          kind: "add_employee",
          employeeName: bodyLines[0].trim()
        }
      }

      // BAJA EMPLEADO
      if (category === 'BAJA') {

        const bajaInline = raw.match(/^BAJA\s+(.+)$/i)

        if (bajaInline) {
          return {
            kind: "del_employee",
            employeeName: bajaInline[1].trim()
          }
        }

        if (bodyLines.length === 0) {
          return {
            kind: "error",
            message: "Debes indicar el nombre del empleado.\nEj: BAJA\nJuan Pérez"
          }
        }

        return {
          kind: "del_employee",
          employeeName: bodyLines[0].trim()
        }
      }

      // HORAS
      if (category === 'HORAS') {

        // Existen dos variantes principales: 
        // A) Con etiquetas: Empleado:, Fecha:, Entrada:, Salida: 
        // B) Sin etiquetas: Name [\n Date] \n (Start|Hours) \n (End opcional según caso) 
        // Intento A) Primero: busco pares clave:valor (multilínea) 
        const labelMap = {}
        for (const ln of bodyLines) {
          const m = ln.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s*:\s*(.+)$/)
          if (m) {
            const key = m[1].toLowerCase()
            const value = m[2].trim()
            labelMap[key] = value
          }
        }

        const hasLabeled =
          'empleado' in labelMap ||
          'fecha' in labelMap ||
          'entrada' in labelMap ||
          'salida' in labelMap

        if (hasLabeled) {
          const employeeQuery = (labelMap['empleado'] || '').trim()
          const dateRaw = (labelMap['fecha'] || '').trim()
          const startRaw = (labelMap['entrada'] || '').trim()
          const endRaw = (labelMap['salida'] || '').trim()

          // Podemos tener dos modalidades: start_end o hours_only 
          // Si hay entrada/salida -> start_end 
          if (employeeQuery && (startRaw || endRaw)) {
            const startTime = normalizeTime(startRaw)
            const endTime = normalizeTime(endRaw)

            if (!startTime || !endTime) {
              return {
                kind: 'error', message: 'Formato inválido. Ej: "HORAS\\nEmpleado: Juan Pérez\\nFecha: 02/03/2026\\nEntrada: 09:00\\nSalida: 18:00"',
              }
            } let dateISO = todayISO()
            if (dateRaw) {
              const parsed = parseDateToISO(dateRaw)
              if (!parsed) {
                return { kind: 'error', message: 'Fecha inválida. Usa "dd/mm/yyyy" o "yyyy-mm-dd". Ej: 02/03/2026', }
              }
              dateISO = parsed
            } return { kind: 'start_end', employeeQuery, dateISO, startTime, endTime }
          }
          // Si no hay entrada/salida, probamos si es hours_only con "Horas:" o línea libre 
          if (employeeQuery && ('horas' in labelMap || 'worked' in labelMap)) {
            const hoursRaw = (labelMap['horas'] || labelMap['worked'] || '').trim()
            const workedHours = parseWorkedHours(hoursRaw)
            if (workedHours == null) {
              return {
                kind: 'error',
                message: 'Horas inválidas. Ej: "HORAS\\nEmpleado: Juan Pérez\\nHoras: 9" o "9 hs".',
              }
            }
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

            if (dateISO && startTime && endTime) {
              return {
                kind: 'start_end',
                employeeQuery,
                dateISO,
                startTime,
                endTime
              }
            }
          }

          if (seq.length >= 3) {

            const employeeQuery = seq[0]
            const startTime = normalizeTime(seq[1])
            const endTime = normalizeTime(seq[2])

            if (startTime && endTime) {
              return {
                kind: 'start_end',
                employeeQuery,
                dateISO: todayISO(),
                startTime,
                endTime
              }
            }
          }

          if (seq.length >= 2) {

            const employeeQuery = seq[0]
            const workedHours = parseWorkedHours(seq[1])

            if (workedHours != null) {
              return {
                kind: 'hours_only',
                employeeQuery,
                dateISO: todayISO(),
                workedHours
              }
            }
          }

          return {
            kind: 'error',
            message: 'No pude interpretar el bloque HORAS'
          }
        }
      }
    }

    // FORMATO SIMPLE UNA LINEA

    const oneLine = s.replace(/[ \t]+/g, ' ').trim()

    const reStartEnd = /^(.+?)[,\s]+(\d{1,2}(?::\d{2})?)[,\s]+(\d{1,2}(?::\d{2})?)$/i
    const reHoursOnly = /^(.+?)[,\s]+(\d+(?:[.,]\d+)?)/i

    const m1 = oneLine.match(reStartEnd)

    if (m1) {

      const employeeQuery = m1[1].trim()
      const startTime = normalizeTime(m1[2])
      const endTime = normalizeTime(m1[3])

      if (startTime && endTime) {
        return {
          kind: 'start_end',
          employeeQuery,
          dateISO: todayISO(),
          startTime,
          endTime
        }
      }
    }

    const m2 = oneLine.match(reHoursOnly)

    if (m2) {

      const employeeQuery = m2[1].trim()
      const workedHours = parseWorkedHours(m2[2])

      if (workedHours != null) {
        return {
          kind: 'hours_only',
          employeeQuery,
          dateISO: todayISO(),
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
    parseIncomingMessage,
    computeHoursFromStartEnd,
    parseWorkedHours,
    normalizeTime,
    parseDateToISO,
    todayISO
  }