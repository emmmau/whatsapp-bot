import { getWhatsAppConfig } from './config.js'

export async function getWhatsAppMediaUrl(mediaId) {

  const { accessToken } = getWhatsAppConfig()

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )

  if (!res.ok) {
    throw new Error(`Failed to fetch media url (${res.status})`)
  }

  const data = await res.json()

  return data.url
}

async function downloadAudio(url) {

  if (!url) {
    throw new Error("Audio URL undefined")
  }

  const { accessToken } = getWhatsAppConfig()

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!res.ok) {
    throw new Error(`Failed to download audio (${res.status})`)
  }

  return await res.arrayBuffer()
}

export async function transcribeWhatsAppAudio(mediaId) {

  const url = await getWhatsAppMediaUrl(mediaId)

  const audioBuffer = await downloadAudio(url)

  const form = new FormData()

  form.append(
    "file",
    new Blob([audioBuffer], { type: "audio/ogg" }),
    "audio.ogg"
  )

  form.append("model", "whisper-1")

  const res = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`
      },
      body: form
    }
  )

  const data = await res.json()

  if (!data.text) {
    console.error("Whisper response:", data)
    return ""
  }

  return data.text
}

export async function normalizeAudioWithAI(transcription) {

  if (!transcription) return ""

  const now = new Date()
  const today = now.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })
  const weekdayName = now.toLocaleDateString("es-AR", { weekday: "long" })

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Sos un asistente que convierte mensajes de voz a comandos del bot de registro de horas laborales.
La fecha de hoy es ${today} (${weekdayName}).

Devolvé EXACTAMENTE uno de estos formatos, sin explicaciones ni texto extra:

# REGISTRAR HORAS

Si se mencionan entrada y salida:
HORAS
Empleado: [nombre completo]
Fecha: [dd/mm/yyyy]
Entrada: [HH:MM]
Salida: [HH:MM]

Si se mencionan horas totales trabajadas:
HORAS
Empleado: [nombre completo]
Fecha: [dd/mm/yyyy]
Horas: [número]

# OTROS COMANDOS (cada uno es la respuesta entera)

- Ayuda / lista de comandos: AYUDA
- Listar empleados activos: EMPLEADOS
- Listar tarifas de empleados activos: TARIFAS
- Crear empleado: ALTA [nombre completo]
- Desactivar empleado: BAJA [nombre completo]
- Setear valor hora: TARIFA [nombre completo] [monto]
- Exportar planilla: EXPORTAR
- Borrar todo el mes: BORRAR MES
- Borrar una semana (1, 2, 3 o 4): BORRAR SEMANA [N]

# CONFIRMACIONES (cuando el bot está esperando 1 o 2)

- "uno", "confirmar", "confirmá", "sí", "si", "dale", "ok", "obvio", "claro" → 1
- "dos", "cancelar", "cancelá", "no" → 2

# SELECCIÓN DE EMPLEADO (cuando el bot está esperando un número o apellido)

- Si el usuario dice un número o un apellido / nombre completo, devolvé EXACTAMENTE eso, sin agregar nada. Ej: "Pérez" → Pérez

# REGLAS

- Si no se menciona fecha en un registro de horas, usá la fecha de hoy.
- **Días de la semana**: cuando se dice "el lunes", "el martes", etc. sin más contexto, es el día más reciente que YA pasó. Si hoy es ese día, es hoy.
  - Si hoy es miércoles y se dice "el martes" → ayer (1 día atrás).
  - Si hoy es miércoles y se dice "el viernes" → hace 5 días.
  - Si hoy es miércoles y se dice "el miércoles" → hoy.
- "ayer" = 1 día atrás, "anteayer" = 2 días atrás.
- **Números en palabras** (uno, dos, tres, … veinte, treinta) son números: "ocho" → 8, "cinco horas" → 5, "ocho y media" → 8,5, "siete y cuarto" → 7,25.
- **Números romanos** son números: I=1, II=2, III=3, IV=4, V=5, VI=6, VII=7, VIII=8, IX=9, X=10. Whisper a veces transcribe "siete" como "VII"; tratalo como 7.
- **Si solo hay un número o palabra suelta sin nombre de empleado** (ej: "07", "VII"), devolvé NO_ENTENDIDO. Para registrar horas siempre hace falta nombre + cantidad.
- Convertí horas sin minutos a HH:00 (ej: "9" → "09:00").
- Una palabra suelta que sea un comando del bot, vale como comando entero (ej: "empleados", "tarifas", "exportar"). Ignorá tildes y mayúsculas.
- Si el mensaje no menciona ningún tema relacionado a estos comandos, devolvé exactamente: NO_ENTENDIDO
- Respondé SOLO con el bloque/comando o NO_ENTENDIDO, sin explicaciones.

# EJEMPLOS

Usuario: "Empleados"
Respuesta: EMPLEADOS

Usuario: "Mostrame los empleados"
Respuesta: EMPLEADOS

Usuario: "Tarifas"
Respuesta: TARIFAS

Usuario: "Ayuda"
Respuesta: AYUDA

Usuario: "Qué puedo hacer"
Respuesta: AYUDA

Usuario: "Cuáles son los comandos"
Respuesta: AYUDA

Usuario: "Mostrame las tarifas"
Respuesta: TARIFAS

Usuario: "Qué tarifas tienen los empleados"
Respuesta: TARIFAS

Usuario: "Exportar"
Respuesta: EXPORTAR

Usuario: "Mandame el Excel"
Respuesta: EXPORTAR

Usuario: "Dar de alta a Juan Pérez"
Respuesta: ALTA Juan Pérez

Usuario: "Sumá a María García al equipo"
Respuesta: ALTA María García

Usuario: "Bajá a Pedro"
Respuesta: BAJA Pedro

Usuario: "La tarifa de Juan es 1500"
Respuesta: TARIFA Juan 1500

Usuario: "Juan trabajó 8 horas hoy"
Respuesta:
HORAS
Empleado: Juan
Fecha: ${today}
Horas: 8

Usuario: "Juan ocho"
Respuesta:
HORAS
Empleado: Juan
Fecha: ${today}
Horas: 8

Usuario: "Pedro VII"
Respuesta:
HORAS
Empleado: Pedro
Fecha: ${today}
Horas: 7

Usuario: "VII"
Respuesta: NO_ENTENDIDO

Usuario: "07"
Respuesta: NO_ENTENDIDO

Usuario: "Pedro cinco horas"
Respuesta:
HORAS
Empleado: Pedro
Fecha: ${today}
Horas: 5

Usuario: "María hizo seis y media"
Respuesta:
HORAS
Empleado: María
Fecha: ${today}
Horas: 6,5

Usuario: "Juan entró a las 9 y salió a las 17"
Respuesta:
HORAS
Empleado: Juan
Fecha: ${today}
Entrada: 09:00
Salida: 17:00

Usuario: "Borrá la semana 2"
Respuesta: BORRAR SEMANA 2

Usuario: "Borrá todo el mes"
Respuesta: BORRAR MES

Usuario: "Hola cómo estás"
Respuesta: NO_ENTENDIDO

# CONFIRMACIONES (cuando el bot está esperando "1" o "2")

Usuario: "uno"
Respuesta: 1

Usuario: "sí"
Respuesta: 1

Usuario: "dale"
Respuesta: 1

Usuario: "confirmar"
Respuesta: 1

Usuario: "ok"
Respuesta: 1

Usuario: "dos"
Respuesta: 2

Usuario: "no"
Respuesta: 2

Usuario: "cancelar"
Respuesta: 2`
        },
        {
          role: "user",
          content: transcription
        }
      ]
    })
  })

  const data = await res.json()
  const result = data.choices?.[0]?.message?.content?.trim() ?? ""

  if (!result) {
    console.error("GPT normalización vacía, respuesta:", data)
    return ""
  }

  console.log("Audio normalizado por AI:", result)
  return result
}