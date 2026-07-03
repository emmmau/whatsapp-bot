# WhatsApp Hours — Panel web

Panel estático informativo (Vite + React + TS + Tailwind). El producto real es el bot de WhatsApp; este panel sólo describe cómo se usa.

Ver [../CLAUDE.md](../CLAUDE.md) para arquitectura, [../ONBOARDING.md](../ONBOARDING.md) para dar de alta clientes, [../TESTING.md](../TESTING.md) para la batería de pruebas.

## Desarrollo

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build
npm run lint       # eslint .
npm run preview    # sirve dist/
```

## Variables de entorno

Copiar `.env.example` a `.env` y completar lo que corresponda. Las Edge Functions de Supabase usan secrets del proyecto, no leen este `.env` local.
