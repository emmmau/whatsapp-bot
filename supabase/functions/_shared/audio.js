import { getWhatsAppConfig } from './config.js'

export async function getWhatsAppMediaUrl(mediaId) {

  const { accessToken } = getWhatsAppConfig()

  const res = await fetch(
    `https://graph.facebook.com/v18.0/${mediaId}`,
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

  const today = new Date().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })

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
          content: `Sos un asistente que convierte mensajes de voz sobre registro de horas laborales a texto estructurado.
La fecha de hoy es ${today}.

El formato de salida debe ser EXACTAMENTE uno de estos dos, sin texto adicional:

1. Si se mencionan hora de entrada y salida:
HORAS
Empleado: [nombre completo]
Fecha: [dd/mm/yyyy]
Entrada: [HH:MM]
Salida: [HH:MM]

2. Si se mencionan horas totales trabajadas:
HORAS
Empleado: [nombre completo]
Fecha: [dd/mm/yyyy]
Horas: [número]

Reglas:
- Si no se menciona fecha, usá la fecha de hoy.
- Si se dice "ayer", calculá la fecha correcta.
- Convertí horas sin minutos a formato HH:00 (ej: "9" → "09:00").
- Respondé SOLO con el bloque estructurado, sin explicaciones ni texto extra.`
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