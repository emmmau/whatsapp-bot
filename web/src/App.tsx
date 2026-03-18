function App() {
  return (
    <div className="min-h-dvh px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-6">
        <header className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
            WhatsApp Hours • MVP
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Registro de horas por WhatsApp</h1>
          <p className="text-sm text-slate-600">
            En este MVP, el panel es solo para configuración básica. El flujo principal sucede por WhatsApp.
          </p>
        </header>

        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Formatos soportados</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="font-mono">Juan Pérez, 09:00, 18:00</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="font-mono">Juan Pérez, 02/03/2026, 09:00, 18:00</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="font-mono">Juan Pérez, 9 horas</div>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Resolución de ambigüedad</h2>
          <p className="mt-2 text-sm text-slate-700">
            Si escribís solo <span className="font-mono">Juan</span> y hay varios empleados (ej: Juan Perez / Juan Sosa), el
            bot te pregunta y podés responder con <span className="font-mono">Juan Perez</span> o solo{' '}
            <span className="font-mono">Perez</span>.
          </p>
        </section>

        <footer className="text-xs text-slate-500">
          Próximo: conexión a Google Sheets, alta de empresas/jefes/empleados desde este panel.
        </footer>
      </div>
    </div>
  )
}

export default App
