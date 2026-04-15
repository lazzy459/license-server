require('dotenv').config()
const express = require('express')
const https = require('https')
const app = express()

app.use(express.json())

// URL whitelist.json dari GitHub kamu
const WHITELIST_URL = "https://raw.githubusercontent.com/lazzy459/license-server/main/whitelist.json"

// Fungsi ambil whitelist dari GitHub
function getWhitelist() {
  return new Promise((resolve, reject) => {
    https.get(WHITELIST_URL, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

// ✅ Validasi Lisensi
app.post('/validate', async (req, res) => {
  const { key, place_id, secret } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ valid: false, reason: "Unauthorized" })
  }

  try {
    const whitelist = await getWhitelist()
    const license = whitelist.licenses.find(l => l.key === key)

    if (!license) {
      return res.json({ valid: false, reason: "Key tidak ditemukan" })
    }

    if (!license.active) {
      return res.json({ valid: false, reason: "Lisensi dinonaktifkan" })
    }

    if (license.place_id && String(license.place_id) !== String(place_id)) {
      return res.json({ valid: false, reason: "PlaceID tidak cocok" })
    }

    if (license.expires && new Date(license.expires) < new Date()) {
      return res.json({ valid: false, reason: "Lisensi expired" })
    }

    return res.json({
      valid: true,
      owner: license.owner_name,
      roblox_id: license.roblox_id,
      expires: license.expires || "Permanent"
    })

  } catch (err) {
    return res.status(500).json({ valid: false, reason: "Gagal baca whitelist" })
  }
})

// ✅ Cek Server Hidup
app.get('/', (req, res) => {
  res.json({ status: "License Server is running ✅" })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))