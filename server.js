require('dotenv').config()
const express = require('express')
const { Pool } = require('pg')
const app = express()

app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ✅ Validasi Lisensi
app.post('/validate', async (req, res) => {
  const { key, place_id, secret } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ valid: false, reason: "Unauthorized" })
  }

  try {
    const result = await pool.query(
      'SELECT * FROM licenses WHERE key = $1 AND is_active = true',
      [key]
    )

    if (result.rows.length === 0) {
      return res.json({ valid: false, reason: "Key tidak ditemukan" })
    }

    const license = result.rows[0]

    if (license.place_id && String(license.place_id) !== String(place_id)) {
      return res.json({ valid: false, reason: "PlaceID tidak cocok" })
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return res.json({ valid: false, reason: "Lisensi expired" })
    }

    return res.json({
      valid: true,
      owner: license.owner_name,
      expires_at: license.expires_at || "Permanent"
    })

  } catch (err) {
    return res.status(500).json({ valid: false, reason: "Server error" })
  }
})

// ✅ Tambah Lisensi Baru
app.post('/add-license', async (req, res) => {
  const { secret, key, owner_name, place_id, days } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  const expires_at = days
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    : null

  try {
    await pool.query(
      'INSERT INTO licenses (key, owner_name, place_id, expires_at) VALUES ($1, $2, $3, $4)',
      [key, owner_name, place_id, expires_at]
    )
    return res.json({ success: true, message: `Lisensi ${key} ditambahkan!` })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

// ✅ Cabut Lisensi
app.post('/revoke', async (req, res) => {
  const { secret, key } = req.body

  if (secret !== process.env.API_SECRET) {
    return res.status(401).json({ success: false, reason: "Unauthorized" })
  }

  try {
    await pool.query(
      'UPDATE licenses SET is_active = false WHERE key = $1', [key]
    )
    return res.json({ success: true, message: `Lisensi ${key} dicabut!` })
  } catch (err) {
    return res.status(500).json({ success: false, reason: err.message })
  }
})

// ✅ Cek Server Hidup
app.get('/', (req, res) => {
  res.json({ status: "License Server is running ✅" })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))