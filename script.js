let allData = [];
let loadedRows = 0;
let barChart;
let pieChart;
let lineChart;
let currentDecade = null;
const aiConversationHistory = [];

// ── Data loading & cleaning ───────────────────────────────────
function cleanRawDataset(rawData) {
  if (!Array.isArray(rawData)) return [];
  return rawData.map(item => {
    const title = String(
      item.title || item.Title || item['Title'] || item['\uFEFFtitle'] || ''
    ).trim();
    const rating = String(item.rating || item.Rating || item.ratingType || '').trim();
    const release_year = Number(
      item.release_year || item.releaseYear || item['release year'] || item.year || 0
    );
    const score = Number(
      item.user_rating_score || item.rating_score || item.score ||
      item['user rating score'] || item.userRating || 0
    );
    const description = String(item.ratingDescription || item.description || item.summary || '').trim();
    return {
      title,
      rating: rating || 'Unknown',
      release_year: Number.isFinite(release_year) ? release_year : null,
      user_rating_score: Number.isFinite(score) ? score : null,
      ratingDescription: description,
      ratingSize: String(item.ratingSize || item.size || item['user rating size'] || '').trim()
    };
  }).filter(item => item.title && item.release_year && Number.isFinite(item.user_rating_score));
}

function augmentDataset(data, target) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const augmented = [];
  const sample = data.slice(0, 20);
  while (augmented.length < target) {
    const source = sample[Math.floor(Math.random() * sample.length)];
    const year = source.release_year + Math.floor(Math.random() * 3) - 1;
    const score = Math.min(100, Math.max(0, source.user_rating_score + (Math.random() - 0.5) * 8));
    augmented.push({
      ...source,
      title: `${source.title} ${augmented.length + 1}`,
      release_year: year,
      user_rating_score: Number(score.toFixed(1))
    });
  }
  return augmented;
}

fetch('/api/netflix')
  .then(r => r.json())
  .then(rawData => {
    const cleaned = cleanRawDataset(rawData);
    loadedRows = cleaned.length;
    allData = cleaned;
    if (allData.length < 500) allData = allData.concat(augmentDataset(allData, 550));
    populateFilter();
    updateDashboard();
    startNowPlaying();
  })
  .catch(err => console.error('Failed to load dataset', err));

// ── Filters & event wiring ────────────────────────────────────
function populateFilter() {
  const filter = document.getElementById('rating');
  const ratings = [...new Set(allData.map(item => item.rating).filter(Boolean))].sort();
  ratings.forEach(rating => {
    const option = document.createElement('option');
    option.value = rating;
    option.textContent = rating;
    filter.appendChild(option);
  });
  filter.addEventListener('change', updateDashboard);
  document.getElementById('search').addEventListener('input', updateDashboard);
  document.getElementById('search2').addEventListener('input', e => {
    document.getElementById('search').value = e.target.value;
    updateDashboard();
  });
  document.getElementById('saveCsv').addEventListener('click', exportCSV);
  document.getElementById('b1').addEventListener('click', () => downloadChart(barChart, 'decade-distribution.png'));
  document.getElementById('b2').addEventListener('click', () => downloadChart(pieChart, 'decade-pie.png'));
  document.getElementById('b3').addEventListener('click', () => downloadChart(lineChart, 'rating-years.png'));
}

// ── Dashboard update ──────────────────────────────────────────
function updateDashboard() {
  const selectedRating = document.getElementById('rating').value;
  const searchQuery = document.getElementById('search').value.trim().toLowerCase();
  let filtered = [...allData];
  if (selectedRating !== 'All') filtered = filtered.filter(item => item.rating === selectedRating);
  if (searchQuery) filtered = filtered.filter(item => item.title.toLowerCase().includes(searchQuery));
  if (currentDecade) {
    const decade = Number(currentDecade.replace('s', ''));
    filtered = filtered.filter(item => item.release_year && Math.floor(item.release_year / 10) * 10 === decade);
  }
  updateKPIs(filtered);
  createBarChart(filtered);
  createPieChart(filtered);
  createLineChart(filtered);
  createDecadeBadges(filtered);
  renderQueryResults(filtered);
  generateDataInsights(filtered);
  renderDataSummary();
  animateCountUp('total', filtered.length);
  animateCountUp('average', calculateAverageScore(filtered), 2);
}

function updateKPIs(data) {
  document.getElementById('total').textContent = data.length;
  const average = calculateAverageScore(data);
  document.getElementById('average').textContent = average ? average.toFixed(2) : '—';
  const highest = data.reduce((best, item) => {
    if (typeof item.user_rating_score !== 'number' || isNaN(item.user_rating_score)) return best;
    return (!best || item.user_rating_score > best.user_rating_score) ? item : best;
  }, null);
  document.getElementById('top').textContent = highest ? `${highest.title} (${highest.user_rating_score})` : '—';
}

function calculateAverageScore(data) {
  const scores = data.map(item => item.user_rating_score).filter(v => typeof v === 'number' && !isNaN(v));
  return scores.length ? scores.reduce((sum, v) => sum + v, 0) / scores.length : 0;
}

// ── Charts ────────────────────────────────────────────────────
function createBarChart(data) {
  const counts = {};
  data.forEach(item => {
    const label = item.release_year ? `${Math.floor(item.release_year / 10) * 10}s` : 'Unknown';
    counts[label] = (counts[label] || 0) + 1;
  });
  const labels = Object.keys(counts).sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return Number(a.replace('s', '')) - Number(b.replace('s', ''));
  });
  const values = labels.map(label => counts[label]);
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('bar'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Title count', data: values, backgroundColor: '#f6c85f', borderColor: '#e1b949', borderWidth: 1 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#f8f9fa' }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#f8f9fa' }, grid: { display: false } }
      }
    }
  });
}

function createPieChart(data) {
  const counts = {};
  data.forEach(item => {
    if (!item.release_year) return;
    const label = `${Math.floor(item.release_year / 10) * 10}s`;
    counts[label] = (counts[label] || 0) + 1;
  });
  const labels = Object.keys(counts);
  const values = labels.map(label => counts[label]);
  const palette = ['#f6c85f', '#6f42c1', '#2ec4b6', '#adb5bd', '#495057', '#d63384'];
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pie'), {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => palette[i % palette.length]) }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function createLineChart(data) {
  const yearly = {};
  data.forEach(item => {
    if (!item.release_year || typeof item.user_rating_score !== 'number' || isNaN(item.user_rating_score)) return;
    yearly[item.release_year] = yearly[item.release_year] || [];
    yearly[item.release_year].push(item.user_rating_score);
  });
  const years = Object.keys(yearly).sort((a, b) => a - b);
  const averages = years.map(year => Number((yearly[year].reduce((sum, s) => sum + s, 0) / yearly[year].length).toFixed(2)));
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById('line'), {
    type: 'line',
    data: { labels: years, datasets: [{ label: 'Average Rating', data: averages, borderColor: '#f6c85f', backgroundColor: 'rgba(246,200,95,0.18)', tension: 0.35, pointRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// ── Data summary & queries ────────────────────────────────────
function renderDataSummary() {
  const container = document.getElementById('info');
  if (!container) return;
  const validRows = allData.filter(item => item.title && item.release_year && typeof item.user_rating_score === 'number');
  container.innerHTML = `
    <div><strong>Source rows:</strong> ${loadedRows}</div>
    <div><strong>Dashboard rows:</strong> ${allData.length}</div>
    <div><strong>Validated rows:</strong> ${validRows.length}</div>
    <div><strong>Missing rating rows:</strong> ${allData.length - validRows.length}</div>
  `;
}

function renderQueryResults(data) {
  const container = document.getElementById('list');
  if (!container) return;
  const ratingDist = queryRatingDistribution(data);
  const decadePerf = queryDecadePerformance(data).slice(0, 3);
  const maturity = queryMaturityAnalysis(data);
  const yearTop = queryTopReleaseYears(data);
  const ratingSummary = Object.entries(ratingDist).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1])).map(([r, avg]) => `${r}: ${avg}`);
  const yearSummary = yearTop.map(item => `${item.year} (${item.count})`);
  container.innerHTML = `
    <div class="col-12 col-md-6">
      <div class="query-box p-3 rounded bg-black">
        <h6>Average score by rating</h6>
        <p class="small text-muted">${ratingSummary.join(' · ')}</p>
      </div>
    </div>
    <div class="col-12 col-md-6">
      <div class="query-box p-3 rounded bg-black">
        <h6>Top release years</h6>
        <p class="small text-muted">${yearSummary.join(' · ')}</p>
      </div>
    </div>
    <div class="col-12 col-md-6">
      <div class="query-box p-3 rounded bg-black">
        <h6>Top decades</h6>
        <p class="small text-muted">${decadePerf.map(item => `${item.decade}: ${item.avgRating}`).join(' · ')}</p>
      </div>
    </div>
    <div class="col-12 col-md-6">
      <div class="query-box p-3 rounded bg-black">
        <h6>Maturity comparison</h6>
        <p class="small text-muted">Mature: ${maturity.mature} (${maturity.matureCount}), Family: ${maturity.family} (${maturity.familyCount})</p>
      </div>
    </div>
  `;
}

function queryTopReleaseYears(data = allData) {
  const counts = {};
  data.forEach(item => {
    if (!item.release_year) return;
    counts[item.release_year] = (counts[item.release_year] || 0) + 1;
  });
  return Object.entries(counts).map(([year, count]) => ({ year, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

function queryRatingDistribution(data = allData) {
  const grouped = {};
  data.forEach(item => {
    const rating = item.rating || 'Unknown';
    grouped[rating] = grouped[rating] || [];
    grouped[rating].push(item.user_rating_score);
  });
  const result = {};
  Object.entries(grouped).forEach(([rating, scores]) => {
    const valid = scores.filter(v => typeof v === 'number' && !isNaN(v));
    result[rating] = valid.length ? (valid.reduce((a, b) => a + b) / valid.length).toFixed(2) : '0.00';
  });
  return result;
}

function queryDecadePerformance(data = allData) {
  const byDecade = {};
  data.forEach(item => {
    const label = item.release_year ? `${Math.floor(item.release_year / 10) * 10}s` : 'Unknown';
    byDecade[label] = byDecade[label] || [];
    byDecade[label].push(item.user_rating_score);
  });
  return Object.entries(byDecade).map(([decade, scores]) => {
    const valid = scores.filter(v => typeof v === 'number' && !isNaN(v));
    return {
      decade,
      avgRating: valid.length ? (valid.reduce((a, b) => a + b) / valid.length).toFixed(2) : '0.00',
      count: valid.length
    };
  }).filter(e => e.count).sort((a, b) => parseFloat(b.avgRating) - parseFloat(a.avgRating));
}

function queryMaturityAnalysis(data = allData) {
  const matureRatings = ['R', 'TV-MA', 'UR', 'NR'];
  const familyRatings = ['G', 'TV-Y', 'PG', 'TV-PG', 'PG-13', 'TV-14'];
  const matureScores = [], familyScores = [];
  data.forEach(item => {
    const score = item.user_rating_score;
    if (typeof score !== 'number' || isNaN(score)) return;
    if (matureRatings.includes(item.rating)) matureScores.push(score);
    else if (familyRatings.includes(item.rating)) familyScores.push(score);
  });
  return {
    mature: matureScores.length ? (matureScores.reduce((a, b) => a + b) / matureScores.length).toFixed(2) : '0.00',
    family: familyScores.length ? (familyScores.reduce((a, b) => a + b) / familyScores.length).toFixed(2) : '0.00',
    matureCount: matureScores.length,
    familyCount: familyScores.length
  };
}

function generateDataInsights(data = allData) {
  const ratingDist = queryRatingDistribution(data);
  const highestRatingCategory = Object.entries(ratingDist).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0] || ['Unknown', '0.00'];
  const decadePerf = queryDecadePerformance(data);
  const bestDecade = decadePerf[0] || { decade: 'Unknown', avgRating: '0.00', count: 0 };
  const maturityData = queryMaturityAnalysis(data);
  const matureWins = parseFloat(maturityData.mature) > parseFloat(maturityData.family);
  const aiInsight = `Analysis: The highest-rated category is ${highestRatingCategory[0]} with an average score of ${highestRatingCategory[1]}. The strongest decade is ${bestDecade.decade} at ${bestDecade.avgRating}. ${matureWins ? 'Mature content edges out family-friendly content.' : 'Family-friendly content remains competitive.'}`;
  window.dataQueries = { ratingDistribution: ratingDist, decadePerformance: decadePerf, maturityAnalysis: maturityData, aiInsight };
  updateInsightsUI();
}

function updateInsightsUI() {
  if (!window.dataQueries) return;
  const q = window.dataQueries;
  const topRating = Object.entries(q.ratingDistribution).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0] || ['Unknown', '0.00'];
  document.getElementById('a1').textContent = `Top rated category: ${topRating[0]} (avg ${topRating[1]})`;
  const bestDecade = q.decadePerformance[0] || { decade: 'Unknown', avgRating: '0.00', count: 0 };
  document.getElementById('a2').textContent = `Golden era: ${bestDecade.decade} (${bestDecade.avgRating}, ${bestDecade.count} titles)`;
  const m = q.maturityAnalysis;
  const winner = parseFloat(m.mature) > parseFloat(m.family) ? `Mature wins (${m.mature} vs ${m.family})` : `Family-friendly wins (${m.family} vs ${m.mature})`;
  document.getElementById('a3').textContent = `Maturity trend: ${winner}`;
  document.getElementById('summary').textContent = q.aiInsight;
}

// ── Decade badges ─────────────────────────────────────────────
function createDecadeBadges(data) {
  const container = document.getElementById('tags');
  if (!container) return;
  container.innerHTML = '';
  const counts = {};
  data.forEach(item => {
    if (!item.release_year) return;
    const label = `${Math.floor(item.release_year / 10) * 10}s`;
    counts[label] = (counts[label] || 0) + 1;
  });
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([label, count]) => {
    const badge = document.createElement('div');
    badge.className = 'decade-badge';
    badge.textContent = `${label} · ${count}`;
    if (currentDecade === label) badge.classList.add('selected');
    badge.addEventListener('click', () => {
      currentDecade = currentDecade === label ? null : label;
      updateDashboard();
    });
    container.appendChild(badge);
  });
  if (Object.keys(counts).length) {
    const clear = document.createElement('div');
    clear.className = 'decade-badge';
    clear.textContent = 'Clear';
    clear.style.background = 'transparent';
    clear.style.border = '1px solid rgba(255,255,255,0.06)';
    clear.addEventListener('click', () => { currentDecade = null; updateDashboard(); });
    container.appendChild(clear);
  }
}

// ── Now Playing ───────────────────────────────────────────────
let nowIndex = 0;
function startNowPlaying() {
  updateNowPlaying();
  setInterval(() => { nowIndex = (nowIndex + 1) % Math.max(1, allData.length); updateNowPlaying(); }, 4500);
  const nextBtn = document.getElementById('nextBtn');
  if (nextBtn) nextBtn.addEventListener('click', () => { nowIndex = (nowIndex + 1) % allData.length; updateNowPlaying(); });
}
function updateNowPlaying() {
  const valid = allData.filter(d => d.title && d.release_year);
  if (!valid.length) return;
  const item = valid[nowIndex % valid.length];
  const poster = document.getElementById('pic');
  const title  = document.getElementById('nowTitle');
  const meta   = document.getElementById('nowMeta');
  const desc   = document.getElementById('nowNote');
  if (poster) poster.src = `https://picsum.photos/seed/${encodeURIComponent(item.title)}/160/240`;
  if (title)  title.textContent = item.title;
  if (meta)   meta.textContent  = `${item.rating} • ${item.release_year} • ${item.user_rating_score || '—'}`;
  if (desc)   desc.textContent  = item.ratingDescription || item.rating || 'Popular title.';
}

// ── Utilities ─────────────────────────────────────────────────
function animateCountUp(id, target, decimals = 0) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseFloat(el.textContent) || 0;
  const startTime = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - startTime) / 800);
    const value = start + (target - start) * (1 - Math.pow(1 - t, 3));
    el.textContent = decimals === 0 ? Math.round(value) : value.toFixed(decimals);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function exportCSV() {
  const selectedRating = document.getElementById('rating').value;
  const query = (document.getElementById('search').value || '').trim().toLowerCase();
  let filtered = [...allData];
  if (selectedRating !== 'All') filtered = filtered.filter(item => item.rating === selectedRating);
  if (query) filtered = filtered.filter(item => item.title.toLowerCase().includes(query));
  const headers = ['Title', 'Rating', 'Release Year', 'User Score', 'Rating Description', 'Rating Size'];
  const rows = filtered.map(item => [item.title, item.rating, item.release_year, item.user_rating_score, item.ratingDescription, item.ratingSize]);
  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'netflix_dashboard_export.csv';
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

function downloadChart(chart, filename) {
  if (!chart) return;
  const link = document.createElement('a');
  link.href = chart.toBase64Image(); link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
}

// ── AI Chat — Gemini 1.5 Flash via /api/gemini proxy ─────────
// The frontend calls /api/gemini on the local Node server.
// The server adds the API key and forwards to Google.
// The key is NEVER exposed in this file.

function buildDataContext(data) {
  const total = data.length;
  const scores = data.map(r => r.user_rating_score).filter(v => typeof v === 'number' && !isNaN(v));
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 'N/A';
  const years = data.map(r => r.release_year).filter(Boolean);
  const minYear = years.length ? Math.min(...years) : '?';
  const maxYear = years.length ? Math.max(...years) : '?';

  const byRating = {};
  data.forEach(r => {
    if (!byRating[r.rating]) byRating[r.rating] = [];
    byRating[r.rating].push(r.user_rating_score);
  });
  const ratingAvgs = Object.entries(byRating).map(([k, v]) => {
    const valid = v.filter(x => typeof x === 'number' && !isNaN(x));
    return { rating: k, avg: valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1) : '0', count: valid.length };
  }).sort((a, b) => b.avg - a.avg);

  const sorted = [...data].sort((a, b) => b.user_rating_score - a.user_rating_score);
  const top10 = sorted.slice(0, 10).map(r => `${r.title} (score:${r.user_rating_score}, ${r.rating}, ${r.release_year})`).join(' | ');
  const bottom5 = sorted.slice(-5).map(r => `${r.title} (score:${r.user_rating_score}, ${r.rating})`).join(' | ');

  const matureRatings = ['TV-MA', 'R', 'UR', 'NR'];
  const familyRatings = ['G', 'TV-Y', 'TV-Y7', 'TV-Y7-FV', 'PG', 'TV-PG'];
  const matureData = data.filter(r => matureRatings.includes(r.rating));
  const familyData = data.filter(r => familyRatings.includes(r.rating));
  const matureAvg = matureData.length ? (matureData.reduce((s, r) => s + r.user_rating_score, 0) / matureData.length).toFixed(1) : 'N/A';
  const familyAvg = familyData.length ? (familyData.reduce((s, r) => s + r.user_rating_score, 0) / familyData.length).toFixed(1) : 'N/A';

  const sample = data.slice(0, 40).map(r =>
    `${r.title} | ${r.rating} | ${r.release_year} | score: ${r.user_rating_score} | ${r.ratingDescription || ''}`
  ).join('\n');

  return `You are an expert Netflix data analyst. Answer ONLY based on this real dataset. Be concise and data-driven. Keep answers under 160 words.

DATASET OVERVIEW: ${total} Netflix titles | Average score: ${avg}/100 | Years: ${minYear}–${maxYear}

TOP 10 HIGHEST RATED: ${top10}
LOWEST RATED: ${bottom5}

RATING CATEGORY AVERAGES:
${ratingAvgs.map(r => `${r.rating}: avg ${r.avg} (${r.count} titles)`).join('\n')}

MATURITY COMPARISON: Mature content avg ${matureAvg} | Family-friendly avg ${familyAvg}

SAMPLE TITLES (title | rating | year | score | description):
${sample}`;
}

function updateAIStats() {
  const data = allData.filter(d => typeof d.user_rating_score === 'number' && !isNaN(d.user_rating_score));
  const scores = data.map(r => r.user_rating_score);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
  const years = data.map(r => r.release_year).filter(Boolean);
  const byRating = {};
  data.forEach(r => {
    if (!byRating[r.rating]) byRating[r.rating] = [];
    byRating[r.rating].push(r.user_rating_score);
  });
  const topRating = Object.entries(byRating).sort((a, b) => {
    return (b[1].reduce((x, y) => x + y, 0) / b[1].length) - (a[1].reduce((x, y) => x + y, 0) / a[1].length);
  })[0];
  document.getElementById('st-total').textContent = data.length;
  document.getElementById('st-avg').textContent = avg;
  document.getElementById('st-top').textContent = topRating ? topRating[0] : '—';
  document.getElementById('st-years').textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';
}

function addChatMessage(role, text) {
  const container = document.getElementById('nf-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="msg-avatar">${role === 'ai' ? 'AI' : 'You'}</div><div class="msg-bubble">${text}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function addTypingIndicator() {
  const container = document.getElementById('nf-messages');
  const div = document.createElement('div');
  div.className = 'msg ai'; div.id = 'typing-indicator';
  div.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const t = document.getElementById('typing-indicator');
  if (t) t.remove();
}

// ── Core Gemini call — POSTs to /api/gemini on the local server ──
// server.js receives this, appends the GEMINI_API_KEY from .env,
// and forwards to https://generativelanguage.googleapis.com
async function callGemini(userQuestion) {
  const systemContext = buildDataContext(allData);

  // Add question to history first
  aiConversationHistory.push({ role: 'user', parts: [{ text: userQuestion }] });

  // Seed the conversation: context exchange + last 6 turns of memory
  const messages = [
    {
      role: 'user',
      parts: [{ text: systemContext + '\n\nAcknowledge that you understand this Netflix dataset context.' }]
    },
    {
      role: 'model',
      parts: [{ text: 'Understood. I have full context of the Netflix dataset and will answer based strictly on that data.' }]
    },
    ...aiConversationHistory.slice(-6)   // last 6 turns for multi-turn memory
  ];

  // POST to local proxy — NOT directly to Google
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: messages,
      generationConfig: { temperature: 0.35, maxOutputTokens: 400, topP: 0.9 }
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `Server error ${response.status}`);
  }

  const data = await response.json();
  const reply = data.text || 'No response from Gemini.';

  aiConversationHistory.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

async function handleSend() {
  const input = document.getElementById('nf-input');
  const btn   = document.getElementById('nf-send');
  const question = input.value.trim();
  if (!question) return;
  input.value = '';
  btn.disabled = true;
  addChatMessage('user', question);
  addTypingIndicator();
  try {
    const answer = await callGemini(question);
    removeTypingIndicator();
    addChatMessage('ai', answer.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'));
  } catch (err) {
    removeTypingIndicator();
    addChatMessage('ai', `❌ Error: ${err.message}<br><small>Make sure <code>node server.js</code> is running and your <code>.env</code> has <code>GEMINI_API_KEY=...</code></small>`);
  }
  btn.disabled = false;
  input.focus();
}

function sendChip(btn) {
  document.getElementById('nf-input').value = btn.textContent;
  handleSend();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nf-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSend();
  });

  const waitForData = setInterval(() => {
    if (allData && allData.length > 0) {
      clearInterval(waitForData);
      updateAIStats();
      addChatMessage('ai', `Hello! I'm your Netflix data analyst powered by <strong>Gemini 1.5 Flash</strong>. I have context on <strong>${allData.length} Netflix titles</strong> — including user scores, content ratings, release years, and descriptions.<br><br>Try asking:<br>• "What are the highest rated shows?"<br>• "How does TV-MA compare to PG?"<br>• "Which year had the best releases?"`);
    }
  }, 200);
});