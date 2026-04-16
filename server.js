require('dotenv').config()
const express = require('express')
const https = require('https')
const http = require('http')
const app = express()

app.use(express.json())

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

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

// Fungsi ambil nama game dari Roblox API
function getGameName(placeId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'games.roblox.com',
      path: `/v1/games/multiget-place-details?placeIds=${placeId}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed && parsed[0] && parsed[0].name) {
            resolve(parsed[0].name)
          } else {
            resolve('Unknown Game')
          }
        } catch {
          resolve('Unknown Game')
        }
      })
    })
    req.on('error', () => resolve('Unknown Game'))
    req.end()
  })
}

// Fungsi ambil username dari Roblox API
function getRobloxUsername(userId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'users.roblox.com',
      path: `/v1/users/${userId}`,
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed && parsed.name) {
            resolve(parsed.name)
          } else {
            resolve('Unknown User')
          }
        } catch {
          resolve('Unknown User')
        }
      })
    })
    req.on('error', () => resolve('Unknown User'))
    req.end()
  })
}

// Fungsi kirim notifikasi ke Discord
function sendDiscordLog(roblox_id, username, place_id, gameName, reason) {
  if (!DISCORD_WEBHOOK_URL) return

  const embed = {
    embeds: [{
      title: "⚠️ Percobaan Akses Tidak Sah!",
      color: 0xff0000,
      fields: [
        { name: "👤 Username Roblox", value: username || "Unknown", inline: true },
        { name: "🆔 Roblox User ID", value: String(roblox_id) || "Unknown", inline: true },
        { name: "🎮 Place ID", value: String(place_id) || "Unknown", inline: true },
        { name: "🗺️ Nama Map", value: gameName || "Unknown", inline: true },
        { name: "❌ Alasan", value: reason || "Tidak diketahui", inline: true }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "License System Logger" }
    }]
  }

  const body = JSON.stringify(embed)
  const webhookUrl = new URL(DISCORD_WEBHOOK_URL)

  const options = {
    hostname: webhookUrl.hostname,
    path: webhookUrl.pathname + webhookUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }

  const req = https.request(options)
  req.on('error', (e) => console.error('Webhook error:', e.message))
  req.write(body)
  req.end()
}

// ✅ Validasi Lisensi
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
      // Ambil info untuk logging
      const place_id = req.body.place_id || "Unknown"
      const [username, gameName] = await Promise.all([
        getRobloxUsername(roblox_id),
        getGameName(place_id)
      ])

      // Kirim log ke Discord
      sendDiscordLog(roblox_id, username, place_id, gameName, "User ID tidak ada di whitelist")

      return res.json({ valid: false, reason: "User ID tidak ada di whitelist" })
    }

    if (!license.active) {
      const place_id = req.body.place_id || "Unknown"
      const [username, gameName] = await Promise.all([
        getRobloxUsername(roblox_id),
        getGameName(place_id)
      ])

      sendDiscordLog(roblox_id, username, place_id, gameName, "Lisensi dinonaktifkan")

      return res.json({ valid: false, reason: "Lisensi dinonaktifkan" })
    }

    if (license.expires && new Date(license.expires) < new Date()) {
      const place_id = req.body.place_id || "Unknown"
      const [username, gameName] = await Promise.all([
        getRobloxUsername(roblox_id),
        getGameName(place_id)
      ])

      sendDiscordLog(roblox_id, username, place_id, gameName, "Lisensi expired")

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
