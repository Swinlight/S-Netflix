// ============================================================
// Netflix Dashboard — server.js
// Node.js + Express proxy server
//
// ROUTES:
//   GET  /api/netflix  — parses CSV → returns JSON to frontend
//   POST /api/gemini   — proxy: adds API key, forwards to Google
//   GET  /*            — serves static files (HTML, CSS, JS, CSV)
//
// SETUP:
//   1. npm install express csv-parse
//   2. Create .env file:  GEMINI_API_KEY=your_key_here
//   3. node server.js
//   4. Open http://localhost:3000
// ============================================================

const express   = require('express');
const fs        = require('fs');
const path      = require('path');
const { parse } = require('csv-parse/sync');

// ── Load .env without requiring the dotenv package ────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('⚠  No .env file found. Create one with: GEMINI_API_KEY=your_key_here');
    return;
  }
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key   = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
}
loadEnv();

// ── Config ────────────────────────────────────────────────────
const app   = express();
const PORT  = Number(process.env.PORT || 3000);
const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`;

// ── Middleware ────────────────────────────────────────────────
app.use(express.static(__dirname));
app.use(express.json({ limit: '2mb' }));

// ── GET /api/netflix — serve CSV data as JSON ─────────────────
function loadNetflixData() {
  try {
    const csvData = fs.readFileSync(path.join(__dirname, 'netflix_show_reviews.csv'), 'utf8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true    // fixes the ﻿title (BOM) column name bug
    });
    return records.map(item => {
      const title             = String(item.title || '').trim();
      const rating            = String(item.rating || '').trim();
      const release_year      = parseInt(item['release year'] || item.release_year || 0);
      const user_rating_score = parseFloat(item['user rating score'] || item.user_rating_score || 0);
      const ratingDescription = String(item.ratingDescription || '').trim();
      const ratingSize        = String(item['user rating size'] || '').trim();
      return {
        title:             title || 'Untitled',
        rating:            rating || 'Unknown',
        release_year:      isNaN(release_year) ? null : release_year,
        user_rating_score: isNaN(user_rating_score) ? null : user_rating_score,
        ratingDescription,
        ratingSize
      };
    }).filter(item => item.title !== 'Untitled' && item.release_year && item.user_rating_score !== null);
  } catch (err) {
    console.error('CSV load error:', err.message);
    return [];
  }
}

app.get('/api/netflix', (req, res) => {
  const data = loadNetflixData();
  if (data.length === 0) {
    return res.status(500).json({ error: 'No data loaded — check netflix_show_reviews.csv exists.' });
  }
  res.json(data);
});

// ── POST /api/gemini — Gemini proxy ───────────────────────────
// Receives { contents, generationConfig } from script.js,
// appends the secret API key from .env, forwards to Google,
// returns { text } back to the browser.
app.post('/api/gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY not set. Create a .env file with: GEMINI_API_KEY=your_key_here'
    });
  }

  const { contents, generationConfig } = req.body;

  if (!contents || !Array.isArray(contents)) {
    return res.status(400).json({ error: 'Missing or invalid contents array.' });
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: generationConfig || {
          temperature:     0.35,
          maxOutputTokens: 400,
          topP:            0.9
        }
      })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const msg = data.error?.message || 'Gemini API error.';
      console.error('Gemini error:', msg);
      return res.status(geminiRes.status).json({ error: msg });
    }

    // Pull text out of Gemini's nested response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      || "Sorry, I couldn't generate a response.";

    res.json({ text });

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error.' });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  const keyOk = process.env.GEMINI_API_KEY ? '✅ loaded' : '❌ missing';
  console.log(`\n🎬  Netflix Dashboard`);
  console.log(`    URL:          http://localhost:${PORT}`);
  console.log(`    Gemini model: ${MODEL}`);
  console.log(`    API key:      ${keyOk}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log(`\n    Create a .env file in this folder:`);
    console.log(`       GEMINI_API_KEY=your_key_here\n`);
  } else {
    console.log('');
  }
});