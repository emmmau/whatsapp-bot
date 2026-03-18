export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export function normalizeHumanText(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeName(s) {
  const norm = normalizeHumanText(s)
  if (!norm) return []
  return norm.split(' ').filter(Boolean)
}

