export async function saveWorkLog(supabase, employee, log) {

  const { data, error } = await supabase
    .from("work_logs")
    .insert({
      employee_id: employee.id,
      date: log.dateISO,

      start_time: log.startTime ?? null,
      end_time: log.endTime ?? null,

      worked_hours: log.workedHours ?? null
    })
    .select()

  if (error) {

    console.error("Error guardando work log:", error)

    return {
      ok: false,
      error
    }
  }

  return {
    ok: true,
    data
  }
}