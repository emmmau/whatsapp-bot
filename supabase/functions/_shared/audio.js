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

export function normalizeSpeechHours(text) {

  if (!text) return ""  
    
  let t = text.toLowerCase()

  // detectar fechas relativas
  let dateWord = null

  if (t.includes("ayer")) dateWord = "ayer"
  if (t.includes("hoy")) dateWord = "hoy"

  // limpiar palabras comunes
  t = t
    .replace(/trabaj[oó]/g, "")
    .replace(/trabaj[oó] de/g, "")
    .replace(/hizo/g, "")
    .replace(/horas?/g, "")
    .replace(/entr[oó] a las/g, "")
    .replace(/sal[ií]o a las/g, "")
    .replace(/desde/g, "")
    .replace(/de /g, "")
    .replace(/ a /g, " ")

  // eliminar hoy/ayer del texto
  t = t.replace("hoy", "")
  t = t.replace("ayer", "")

  t = t.trim()

  // convertir horas simples a HH:00
  t = t.replace(/\b(\d{1,2})\b/g, (match) => {

    const n = Number(match)

    if (n <= 23) {
      return n.toString().padStart(2, "0") + ":00"
    }

    return match
  })

  // normalizar espacios
  t = t.replace(/\s+/g, " ").trim()

  // agregar indicador de fecha si existe
  if (dateWord) {
    t = `${t} ${dateWord}`
  }

  return t

  
}