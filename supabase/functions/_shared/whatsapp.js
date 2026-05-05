import { getWhatsAppConfig } from './config.js'

export async function sendWhatsAppText(toPhone, text) {
  const { accessToken, phoneNumberId } = getWhatsAppConfig()
  
  if (!accessToken) throw new Error("WHATSAPP_ACCESS_TOKEN is missing or empty")
  if (!phoneNumberId) throw new Error("WHATSAPP_PHONE_NUMBER_ID is missing or empty")
  
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`

  console.log("RAW toPhone:", toPhone)

  let phone = toPhone.replace(/\D/g, "")

  if (phone.startsWith("549")) {
  phone = "54" + phone.substring(3)
    }

  console.log("PHONE FINAL:", phone)

  console.log("Sending WhatsApp message to:", phone)
  console.log("Phone number ID:", phoneNumberId)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error("WhatsApp error response:", body)
    throw new Error(`WhatsApp send failed (${res.status}): ${body}`)
  }
}