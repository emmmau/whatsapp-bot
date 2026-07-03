export function getSupabaseConfig() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return { url, serviceRoleKey }
}

export function getWhatsAppConfig() {
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? ''
  const accessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? ''
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? ''
  if (!verifyToken || !accessToken || !phoneNumberId) {
    throw new Error('Missing WhatsApp env vars (WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)')
  }
  return { verifyToken, accessToken, phoneNumberId }
}

export function normalizePhone(input) {
  return input.replace(/[^\d+]/g, '')
}
