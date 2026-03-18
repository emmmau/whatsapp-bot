import { tokenizeName } from './text.js'

export function employeeMatchesQuery(employeeName, query) {
  const employeeTokens = tokenizeName(employeeName)
  const queryTokens = tokenizeName(query)
  if (queryTokens.length === 0) return false

  // Require every query token to be present as a full token in employee name.
  // This makes "perez" match "juan perez", and "juan" match both "juan perez" and "juan sosa".
  return queryTokens.every((qt) => employeeTokens.includes(qt))
}

export function resolveEmployeeFromCandidates(
  candidates,
  answer,
){
  const matching = candidates.filter((c) => employeeMatchesQuery(c.name, answer))
  if (matching.length === 1) return { kind: 'resolved', employee: matching[0] }
  if (matching.length > 1) return { kind: 'ambiguous', candidates: matching }
  return { kind: 'no_match' }
}

export async function findEmployees(supabase, employeeName, companyId) {

  if (!employeeName) {
    return []
  }

  const { data } = await supabase
    .from("employees")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("active", true)

  const query = employeeName.toLowerCase()

  return (data ?? []).filter((e) =>
    e.name.toLowerCase().includes(query)
  )
}

