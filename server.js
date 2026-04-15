require('dotenv').config()
const express = require('express')
const https = require('https')
const app = express()

app.use(express.json())

function getWhitelist() {
  return new Promise((resolve, reject) => {
    const url = `https://raw.githubusercontent.com/lazzy459/license-server/main/whitelist.json?t=${Date.now()}`
    https.get(url, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (!parsed || !parsed.licenses) {
            reject(new Error("Format whitelist tidak valid"))
            return
          }
          resolve(parsed)
        } catch (e) {
          reject(new Error("Gagal parse JSON: " + e.message))
        }
      })
    }).on('error', (e) => reject(new Error("Gagal fetch whitelist: " + e.message)))
  })
}

app.post('/validate', async (req, res) => {
  const { roblox_id, secret } = req.body

  if (!roblox_id || !secret) {
    return res.status(400).json({ valid: false, reason: "Parameter kurang" })
  }

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ valid: false, reason: "Unauthorized" })
  }

  try {
    const whitelist = await getWhitelist()
    const license = whitelist.licenses.find(l =>
      String(l.roblox_id) === String(roblox_id)
    )

    if (!license) {
      return res.json({ valid: false, reason: "User ID tidak ada di whitelist" })
    }

    if (!license.active) {
      return res.json({ valid: false, reason: "Lisensi dinonaktifkan" })
    }

    if (license.expires && new Date(license.expires) < new Date()) {
      return res.json({ valid: false, reason: "Lisensi expired" })
    }

    return res.json({ valid: true, owner: license.owner_name })

  } catch (err) {
    console.error("Error:", err.message)
    return res.status(500).json({ valid: false, reason: "Server error: " + err.message })
  }
})

app.get('/', (req, res) => {
  res.json({ status: "License Server is running ✅" })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
