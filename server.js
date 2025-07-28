// server.js
const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const app = express();
const PORT = 3000;

let data = [];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🔁 Accept form submission
app.post('/submit', (req, res) => {
  const { school, name, category } = req.body;
  if (!school || !name || !category) return res.status(400).send("Missing fields");

  const categories = category.split(',').map(c => c.trim());
  categories.forEach(cat => data.push({ school, name, category: cat }));

  fs.writeFileSync('data.json', JSON.stringify(data));
  res.send("Success");
});

// 📊 Show sorted results in admin.html
app.get('/results', (req, res) => {
  const sorted = [...data].sort((a, b) => a.school.localeCompare(b.school));
  res.json(sorted);
});

// 📁 Export to Excel
app.get('/export', (req, res) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Log');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=log.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));