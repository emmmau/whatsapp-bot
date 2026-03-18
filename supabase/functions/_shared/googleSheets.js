async function getGoogleAccessToken() {

  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")

  if (!serviceAccountJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var missing")
  }
  
  const serviceAccount = JSON.parse(serviceAccountJson)
  
  const now = Math.floor(Date.now() / 1000)

  const header = {
    alg: "RS256",
    typ: "JWT"
  }

  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }

  const encoder = new TextEncoder()

  const base64 = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  const header64 = base64(header)
  const payload64 = base64(payload)

  const data = `${header64}.${payload64}`

  const key = await crypto.subtle.importKey(
    "pkcs8",
    str2ab(serviceAccount.private_key),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  )

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(data)
  )

  const jwt =
    `${data}.` +
    btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body:
      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  })

  const json = await res.json()

  return json.access_token
}

function str2ab(pem) {

  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "")

  const binary = atob(b64)

  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}


export async function appendWorkLogToCompanySheet(
  supabase,
  workLog
) {

  const token = await getGoogleAccessToken()

  const { data: company } = await supabase
    .from("companies")
    .select("name, google_spreadsheet_id, google_sheet_name")
    .eq("id", workLog.companyId)
    .maybeSingle()

  if (!company) return

  const row = [
    workLog.dateISO,
    workLog.employeeName,
    workLog.startTime ?? "",
    workLog.endTime ?? "",
    workLog.workedHours,
    workLog.bossName,
    company.name
  ]

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${company.google_spreadsheet_id}` +
    `/values/${company.google_sheet_name}!A:G:append?valueInputOption=USER_ENTERED`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      values: [row]
    })
  })

  if (!res.ok) {

    const body = await res.text()

    console.error("Google Sheets error:", body)
  }
}