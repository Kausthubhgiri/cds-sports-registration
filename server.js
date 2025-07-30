// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = 3000;
const filePath = path.join(__dirname, 'results.json');

let data = [];

// 🔄 Load existing entries from results.json on startup
try {
  const fileData = fs.readFileSync(filePath, 'utf8');
  if (fileData.trim()) {
    data = JSON.parse(fileData);
    console.log(`🟢 Loaded ${data.length} existing entries`);
  } else {
    console.log("⚠️ results.json is empty. Starting fresh.");
    data = [];
  }
} catch (err) {
  console.log("⚠️ results.json not found. Starting fresh.");
  data = [];
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 📝 Route: Handle form submissions at /submit
app.post('/submit', (req, res) => {
  const { school, name, category } = req.body;
  if (!school || !name || !category) return res.status(400).send("Missing fields");

  const categories = category.split(',').map(c => c.trim());
  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  categories.forEach(cat => {
    data.push({ school, name, category: cat, timestamp });
  });

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("Success");
});

// 🆕 Route: Duplicate logic for /results (POST) — matches frontend call
app.post('/results', (req, res) => {
  const { school, name, category } = req.body;
  if (!school || !name || !category) return res.status(400).send("Missing fields");

  const categories = category.split(',').map(c => c.trim());
  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  categories.forEach(cat => {
    data.push({ school, name, category: cat, timestamp });
  });

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("Success");
});

// 📊 Route: Return sorted results to admin dashboard
app.get('/results', (req, res) => {
  const sorted = [...data].sort((a, b) => a.school.localeCompare(b.school));
  res.json(sorted);
});

// 📁 Route: Export results to Excel
app.get('/export', (req, res) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Log');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=log.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// 🔁 Route: Reset all saved responses
app.post('/reset-all', (req, res) => {
  data = [];
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("All responses have been reset.");
});

// 🔁 Route: Reset last response entry
app.post('/reset-last', (req, res) => {
  if (data.length > 0) {
    data.pop();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.send("Last response has been removed.");
  } else {
    res.send("No responses to remove.");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});