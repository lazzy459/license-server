require('dotenv').config()
const express = require('express')
const https = require('https')
const { Pool } = require('pg')
const app = express()

app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
})

pool.on('error', (err) => {
  console.error('Database pool error:', err.message)
})

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

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
        } catch { resolve('Unknown Game') }
      })
    })
    req.on('error', () => resolve('Unknown Game'))
    req.end()
  })
}

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
          resolve(parsed && parsed.name ? parsed.name : 'Unknown User')
        } catch { resolve('Unknown User') }
      })
    })
    req.on('error', () => resolve('Unknown User'))
    req.end()
  })
}

function sendDiscordLog(roblox_id, username, place_id, gameName, reason) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log("❌ DISCORD_WEBHOOK_URL tidak ada!")
    return
  }

  console.log("📤 Mengirim log ke Discord...")

  const embed = {
    embeds: [{
      title: "⚠️ Percobaan Akses Tidak Sah!",
      color: 0xff0000,
      fields: [
        { name: "👤 Username Roblox", value: String(username || "Unknown"), inline: true },
        { name: "🆔 Roblox User ID", value: String(roblox_id || "Unknown"), inline: true },
        { name: "🎮 Place ID", value: String(place_id || "Unknown"), inline: true },
        { name: "🗺️ Nama Map", value: String(gameName || "Unknown"), inline: true },
        { name: "❌ Alasan", value: String(reason || "Tidak diketahui"), inline: true }
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

  const req = https.request(options, (res) => {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => {
      console.log("Discord webhook status:", res.statusCode)
    })
  })
  req.on('error', (e) => console.error('Webhook error:', e.message))
  req.write(body)
  req.end()
}

// ✅ Validasi Lisensi
app.post('/validate', async (req, res) => {
  const { roblox_id, place_id, secret } = req.body

  if (!roblox_id || !secret) {
    return res.status(400).json({ valid: false, reason: "Parameter kurang" })
  }

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ valid: false, reason: "Unauthorized" })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM licenses WHERE roblox_id = $1 AND is_active = true',
      [String(roblox_id)]
    )

    if (result.rows.length === 0) {
      const [username, gameName] = await Promise.all([
        getRobloxUsername(roblox_id),
        getGameName(place_id)
      ])
      sendDiscordLog(roblox_id, username, place_id, gameName, "User ID tidak ada di whitelist")
      return res.json({ valid: false, reason: "User ID tidak ada di whitelist" })
    }

    const license = result.rows[0]

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
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

// ✅ Tambah Lisensi
app.post('/add-license', async (req, res) => {
  const { secret, roblox_id, owner_name, days } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  const expires_at = days
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    : null

  try {
    await pool.query(
      'INSERT INTO licenses (roblox_id, owner_name, expires_at) VALUES ($1, $2, $3) ON CONFLICT (roblox_id) DO UPDATE SET is_active = true, owner_name = $2, expires_at = $3',
      [String(roblox_id), owner_name, expires_at]
    )
    return res.json({ success: true, message: `Lisensi ${roblox_id} ditambahkan!` })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

// ✅ Cabut Lisensi
app.post('/revoke', async (req, res) => {
  const { secret, roblox_id } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  try {
    await pool.query(
      'UPDATE licenses SET is_active = false WHERE roblox_id = $1',
      [String(roblox_id)]
    )
    return res.json({ success: true, message: `Lisensi ${roblox_id} dicabut!` })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

// ✅ Aktifkan Lisensi
app.post('/enable', async (req, res) => {
  const { secret, roblox_id } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  try {
    await pool.query(
      'UPDATE licenses SET is_active = true WHERE roblox_id = $1',
      [String(roblox_id)]
    )
    return res.json({ success: true, message: `Lisensi ${roblox_id} diaktifkan!` })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

// ✅ List Semua Lisensi
app.get('/list', async (req, res) => {
  const { secret } = req.query

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  try {
    const result = await pool.query('SELECT * FROM licenses ORDER BY created_at DESC')
    return res.json({ success: true, licenses: result.rows })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

app.get('/', (req, res) => {
  res.json({ status: "License Server is running ✅" })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
