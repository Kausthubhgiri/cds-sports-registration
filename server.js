// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const PORT = 3000;
const filePath = path.join(__dirname, 'results.json');

// 📁 Setup multer for image uploads
const upload = multer({ dest: 'uploads/' });

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

// 📝 Route: Handle form submissions at /submit (with photo upload)
app.post('/submit', upload.single('photo'), (req, res) => {
  const { school, name, chest, dob, ageCategory, gender, events } = req.body;
  const photo = req.file;

  if (!school || !name || !chest || !dob || !ageCategory || !gender || !events || !photo) {
    return res.status(400).send("Missing fields");
  }

  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  const entry = {
    school,
    name,
    chest,
    dob,
    ageCategory,
    gender,
    events: Array.isArray(events) ? events : [events],
    photoPath: photo.path,
    timestamp
  };

  data.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.json({ message: "Success" });
});

// 🆕 Route: Duplicate logic for /results (POST) — matches frontend call
app.post('/results', upload.single('photo'), (req, res) => {
  const { school, name, chest, dob, ageCategory, gender, events } = req.body;
  const photo = req.file;

  if (!school || !name || !chest || !dob || !ageCategory || !gender || !events || !photo) {
    return res.status(400).send("Missing fields");
  }

  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  const entry = {
    school,
    name,
    chest,
    dob,
    ageCategory,
    gender,
    events: Array.isArray(events) ? events : [events],
    photoPath: photo.path,
    timestamp
  };

  data.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("Success");
});

// 📊 Route: Return sorted results to admin dashboard
app.get('/results', (req, res) => {
  const sorted = [...data].sort((a, b) => a.school.localeCompare(b.school));
  res.json(sorted);
});

// 📁 Route: Export results to Excel in grouped format
app.get('/export', (req, res) => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CDS Sports Results');

  // Helper to group by key
  function groupBy(array, key) {
    return array.reduce((acc, item) => {
      const group = item[key];
      acc[group] = acc[group] || [];
      acc[group].push(item);
      return acc;
    }, {});
  }

  const schools = groupBy(data, 'school');

  for (const [schoolName, entries] of Object.entries(schools)) {
    sheet.addRow([`School: ${schoolName}`]);

    // Flatten all events across entries
    const eventMap = {};
    entries.forEach(entry => {
      entry.events.forEach(event => {
        eventMap[event] = eventMap[event] || [];
        eventMap[event].push(entry);
      });
    });

    for (const [eventName, participants] of Object.entries(eventMap)) {
      sheet.addRow([`Event: ${eventName}`]);
      sheet.addRow(['Name', 'Chest', 'DOB', 'Age Category', 'Gender', 'Timestamp']);

      participants.forEach(p => {
        sheet.addRow([
          p.name,
          p.chest,
          p.dob,
          p.ageCategory,
          p.gender,
          p.timestamp
        ]);
      });

      sheet.addRow([]); // Blank row between events
    }

    sheet.addRow([]); // Blank row between schools
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=cds_sports_results.xlsx');

  workbook.xlsx.write(res).then(() => res.end());
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
// 🏫 Route: Get list of all unique schools from results.json
app.get('/schools', (req, res) => {
  const schools = [...new Set(data.map(entry => entry.school))].sort();
  res.json(schools);
});

app.get('/export-school', async (req, res) => {
  const ExcelJS = require('exceljs');
  const schoolName = req.query.school;

  if (!schoolName) {
    return res.status(400).send("School name is required.");
  }

  const filtered = data.filter(entry =>
    entry.school.toLowerCase() === schoolName.toLowerCase()
  );

  if (filtered.length === 0) {
    return res.status(404).send("No entries found for this school.");
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Responses – ${schoolName}`);

  const ageOrder = ["Under 11", "Under 14", "Under 16", "Under 17", "Under 19"];

  const eventMap = {};
  filtered.forEach(entry => {
    entry.events.forEach(event => {
      eventMap[event] = eventMap[event] || [];
      eventMap[event].push(entry);
    });
  });

  for (const [eventName, participants] of Object.entries(eventMap)) {
    sheet.addRow([`Event: ${eventName}`]);
    sheet.addRow(['Name', 'Chest', 'DOB', 'Age Category', 'Gender', 'Timestamp']);

    participants
      .sort((a, b) => ageOrder.indexOf(a.ageCategory) - ageOrder.indexOf(b.ageCategory))
      .forEach(p => {
        sheet.addRow([
          p.name,
          p.chest,
          p.dob,
          p.ageCategory,
          p.gender,
          p.timestamp
        ]);
      });

    sheet.addRow([]); // Blank row between events
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${schoolName}_responses.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
});