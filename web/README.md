# WhatsApp Hours SaaS (MVP)

## Qué hace

Un bot de WhatsApp recibe mensajes de un jefe autorizado y registra horas de empleados:

- Valida el jefe por número de teléfono
- Identifica la empresa
- Parsea el mensaje (3 formatos)
- Resuelve ambigüedad de empleados (ej: "Juan" → elegir entre "Juan Perez" / "Juan Sosa" respondiendo "Perez" o el nombre completo)
- Guarda en `work_logs`
- Responde confirmación por WhatsApp

## Estructura

- `src/`: panel web mínimo (Vite + React + TS + Tailwind)
- `supabase/migrations/001_init.sql`: tablas
- `supabase/migrations/002_google_sheets.sql`: config por empresa para Google Sheets
- `supabase/functions/whatsapp-webhook/index.ts`: webhook WhatsApp (Edge Function)
- `supabase/functions/_shared/*`: parser + matching + WhatsApp sender + config

## Variables de entorno

Copiá `.env.example` a `.env` y completá lo que corresponda.

> Nota: en Supabase, las Edge Functions usan variables configuradas en el proyecto (no leen automáticamente tu `.env` local).

## Desarrollo del panel

```bash
npm install --cache .npm-cache-local
npm run dev
```

## Próximo paso (Google Sheets)

En el PRD, cada empresa sincroniza a su Google Sheet. Ya está implementado:

- guardar en DB la configuración por empresa (`companies.google_spreadsheet_id` / `companies.google_sheet_name`)
- autenticar con service account vía `GOOGLE_SERVICE_ACCOUNT_JSON`
- `appendRow` cada vez que se crea un `work_log`

Para activarlo:

- Compartí el Spreadsheet con el email del service account.
- Cargá el secreto `GOOGLE_SERVICE_ACCOUNT_JSON` en Supabase (Edge Functions).
- Seteá `google_spreadsheet_id` y `google_sheet_name` en la empresa (`companies`).

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
