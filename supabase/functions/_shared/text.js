export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function normalizeHumanText(s) {
  return stripAccents(s)
    .toLowerCase()
    // Reemplazar puntuación por espacio (Whisper agrega puntos al final de las
    // transcripciones, lo que rompía el matching de empleados tipo "Sosa.").
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeName(s) {
  const norm = normalizeHumanText(s)
  if (!norm) return []
  return norm.split(' ').filter(Boolean)
}

// Único formato de fecha para mostrar al usuario (WhatsApp) y para
// escribir en Google Sheets. La verdad es `dd/mm/yyyy`.
// El input es la fecha ISO `yyyy-mm-dd` que usamos internamente.
export function formatDateDDMMYYYY(isoDate) {
  if (!isoDate) return ''
  const [yyyy, mm, dd] = String(isoDate).slice(0, 10).split('-')
  if (!yyyy || !mm || !dd) return ''
  return `${dd}/${mm}/${yyyy}`
}

// Formato es-AR para mostrar plata/horas:
// entero → "1500"; decimal → "1500,50" (siempre 2 decimales si tiene parte fraccionaria).
export function formatNumberES(n) {
  if (n == null || n === '') return ''
  const num = Number(n)
  if (!Number.isFinite(num)) return ''
  if (Number.isInteger(num)) return num.toString()
  return num.toFixed(2).replace('.', ',')
}

