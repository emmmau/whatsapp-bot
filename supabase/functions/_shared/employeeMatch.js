import { tokenizeName } from './text.js'

export function employeeMatchesQuery(employeeName, query) {
  const employeeTokens = tokenizeName(employeeName)
  const queryTokens = tokenizeName(query)
  if (queryTokens.length === 0) return false

  // Require every query token to be present as a full token in employee name.
  // This makes "perez" match "juan perez", and "juan" match both "juan perez" and "juan sosa".
  return queryTokens.every((qt) => employeeTokens.includes(qt))
}
