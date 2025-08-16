const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const multer = require('multer');

const app = express();
const PORT = 3000;
const filePath = path.join(__dirname, 'results.json');

// 📁 Setup multer for image uploads
const upload = multer({ dest: 'uploads/' });

// 📷 Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// 📊 Load chest number ranges from Excel
let chestRanges = {};
let chestTracker = {};

async function loadChestRanges() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('chest_numbers.xlsx');
  const sheet = workbook.getWorksheet(1);

  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return; // Skip header
    const school = row.getCell(1).value;
    const start = parseInt(row.getCell(2).value);
    const end = parseInt(row.getCell(3).value);
    chestRanges[school] = { start, end };
    chestTracker[school] = start;
  });
}

loadChestRanges();

// 📝 Route: Handle form submissions at /submit (with photo upload)
app.post('/submit', upload.single('photo'), (req, res) => {
  const { school, name, dob, gender, events } = req.body;
  const photo = req.file;

  // ✅ Validate required fields
  if (!school || !name || !dob || !gender || !events || !photo) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // ✅ Normalize inputs
  const normalizedName = name.trim().toLowerCase();
  const normalizedSchool = school.trim().toLowerCase();

  // ✅ Check for duplicate entry (same name + same school)
  const duplicate = data.find(entry =>
    entry.name.trim().toLowerCase() === normalizedName &&
    entry.school.trim().toLowerCase() === normalizedSchool
  );

  if (duplicate) {
    return res.status(400).json({ error: "This participant is already registered from this school." });
  }

  // ✅ Auto-calculate age category from DOB
  function getAgeCategory(dob) {
    const birthYear = new Date(dob).getFullYear();
    const age = new Date().getFullYear() - birthYear;

    if (age <= 10) return 'Under 11';
    if (age <= 13) return 'Under 14';
    if (age <= 15) return 'Under 16';
    if (age === 16) return 'Under 17';
    if (age <= 18) return 'Under 19';
    return 'Overage';
  }

  const ageCategory = getAgeCategory(dob);

  // ✅ Validate chest number range
  const range = chestRanges[school.trim()];
  if (!range) {
    return res.status(400).json({ error: "School not found in chest number database." });
  }

  const nextChest = chestTracker[school]++;
  if (nextChest > range.end) {
    return res.status(400).json({ error: "Chest number range exhausted for this school." });
  }

  // ✅ Format timestamp
  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  // ✅ Sanitize events
  const sanitizedEvents = Array.isArray(events)
    ? events.map(e => e.trim())
    : typeof events === 'string'
      ? [events.trim()]
      : [];

  if (sanitizedEvents.length === 0) {
    return res.status(400).json({ error: "No events selected." });
  }

  // ✅ Construct entry
  const entry = {
    school: school.trim(),
    name: name.trim(),
    chest: nextChest,
    dob,
    ageCategory,
    gender,
    events: sanitizedEvents,
    photoPath: `/uploads/${photo.filename}`,
    timestamp
  };

  // ✅ Save entry
  data.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  // ✅ Respond
  res.json({ message: "Success", chest: nextChest });
});
// 🆕 Route: Duplicate logic for /results (POST) — matches frontend call
app.post('/results', upload.single('photo'), (req, res) => {
  const { school, name, dob, ageCategory, gender, events } = req.body;
  const photo = req.file;

  if (!school || !name || !dob || !ageCategory || !gender || !events || !photo) {
    return res.status(400).send("Missing fields");
  }

  const range = chestRanges[school];
  if (!range) {
    return res.status(400).send("School not found in chest number database.");
  }

  const nextChest = chestTracker[school]++;
  if (nextChest > range.end) {
    return res.status(400).send("Chest number range exhausted for this school.");
  }

  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  const entry = {
    school,
    name,
    chest: nextChest,
    dob,
    ageCategory,
    gender,
    events: Array.isArray(events) ? events : [events],
    photoPath: `/uploads/${photo.filename}`,
    timestamp
  };

  data.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("Success");
});

// 📊 Route: Return sorted results to admin dashboard (reads fresh data)
app.get('/results', (req, res) => {
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    const parsed = fileData.trim() ? JSON.parse(fileData) : [];
    const sorted = [...parsed].sort((a, b) => a.school.localeCompare(b.school));
    res.json(sorted);
  } catch (err) {
    console.error("❌ Failed to read results.json:", err);
    res.status(500).json({ error: "Failed to load results" });
  }
});

// 📁 Route: Export results to Excel in grouped format (uses fresh data)
app.get('/export', (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CDS Sports Results');
  const ageOrder = ["Under 11", "Under 14", "Under 16", "Under 17", "Under 19"];

  function groupBy(array, key) {
    return array.reduce((acc, item) => {
      const group = item[key];
      acc[group] = acc[group] || [];
      acc[group].push(item);
      return acc;
    }, {});
  }

  let exportData = [];
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    exportData = fileData.trim() ? JSON.parse(fileData) : [];
  } catch (err) {
    console.error("❌ Failed to read results.json:", err);
    return res.status(500).send("Failed to export data");
  }

  const schools = groupBy(exportData, 'school');

  for (const [schoolName, entries] of Object.entries(schools)) {
    sheet.addRow([`School: ${schoolName}`]);

    const eventMap = {};
    entries.forEach(entry => {
      entry.events.forEach(event => {
        eventMap[event] = eventMap[event] || [];
        eventMap[event].push(entry);
      });
    });

    for (const [eventName, participants] of Object.entries(eventMap)) {
      sheet.addRow([`Event: ${eventName}`]);

      const ageGroups = {};
      participants.forEach(p => {
        ageGroups[p.ageCategory] = ageGroups[p.ageCategory] || [];
        ageGroups[p.ageCategory].push(p);
      });

      const sortedAgeGroups = ageOrder.filter(age => ageGroups[age]);

      for (const ageCategory of sortedAgeGroups) {
        sheet.addRow([`Age Category: ${ageCategory}`]);
        sheet.addRow(['Name', 'Chest', 'DOB', 'Gender', 'Timestamp']);

        ageGroups[ageCategory].forEach(p => {
          sheet.addRow([
            p.name,
            p.chest,
            p.dob,
            p.gender,
            p.timestamp
          ]);
        });

        sheet.addRow([]);
      }

      sheet.addRow([]);
    }

    sheet.addRow([]);
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
// 🔁 Route: Reset last response entry and chest number
app.post('/reset-last', (req, res) => {
  if (data.length > 0) {
    const lastEntry = data.pop();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Roll back chest number for the corresponding school
    const school = lastEntry.school;
    if (chestTracker[school] && chestTracker[school] > chestRanges[school].start) {
      chestTracker[school]--;
    }

    res.send("Last response and chest number have been removed.");
  } else {
    res.send("No responses to remove.");
  }
});
// 🏫 Route: Get list of all unique schools from results.json
app.get('/schools', (req, res) => {
  const schools = [...new Set(data.map(entry => entry.school))].sort();
  res.json(schools);
});

// 🏫 Route: Export responses for a specific school
app.get('/export-school', async (req, res) => {
  const schoolName = req.query.school;

  if (!schoolName) {
    return res.status(400).send("School name is required.");
  }

    let exportData = [];
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    exportData = fileData.trim() ? JSON.parse(fileData) : [];
  } catch (err) {
    console.error("❌ Failed to read results.json:", err);
    return res.status(500).send("Failed to export school data");
  }

  const filtered = exportData.filter(entry =>
    entry.school.toLowerCase() === schoolName.toLowerCase()
  );

  if (filtered.length === 0) {
    return res.status(404).send("No entries found for this school.");
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Responses – ${schoolName}`);

  const eventMap = {};
  filtered.forEach(entry => {
    entry.events.forEach(event => {
      eventMap[event] = eventMap[event] || [];
      eventMap[event].push(entry);
    });
  });

  const ageOrder = ["Under 11", "Under 14", "Under 16", "Under 17", "Under 19"];

  for (const [eventName, participants] of Object.entries(eventMap)) {
    sheet.addRow([`Event: ${eventName}`]);

    const ageGroups = {};
    participants.forEach(p => {
      ageGroups[p.ageCategory] = ageGroups[p.ageCategory] || [];
      ageGroups[p.ageCategory].push(p);
    });

    const sortedAgeGroups = Object.keys(ageGroups).sort(
      (a, b) => ageOrder.indexOf(a) - ageOrder.indexOf(b)
    );

    for (const ageCategory of sortedAgeGroups) {
      sheet.addRow([`Age Category: ${ageCategory}`]);
      sheet.addRow(['Name', 'Chest', 'DOB', 'Gender', 'Timestamp']);

      ageGroups[ageCategory].forEach(p => {
        sheet.addRow([
          p.name,
          p.chest,
          p.dob,
          p.gender,
          p.timestamp
        ]);
      });

      sheet.addRow([]);
    }

    sheet.addRow([]);
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${schoolName.replace(/\s+/g, '_')}_responses.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
});
// 🧮 Route: Get next available chest number for a school
app.get('/next-chest', (req, res) => {
  const school = req.query.school;
  if (!school) return res.json({ chest: null });

  const normalized = school.trim().toLowerCase();

  const matchKey = Object.keys(chestRanges).find(
    key => key.trim().toLowerCase() === normalized
  );

  if (!matchKey) {
    return res.json({ chest: null });
  }

  const range = chestRanges[matchKey];
  const next = chestTracker[matchKey];

  if (!range || next > range.end) {
    return res.json({ chest: null });
  }

  res.json({ chest: next });
});
app.get('/video/:filename', (req, res) => {
  const videoPath = path.join(__dirname, 'uploads', req.params.filename);
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  const chunkSize = end - start + 1;
  const file = fs.createReadStream(videoPath, { start, end });
  const head = {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': 'video/mp4',
  };

  res.writeHead(206, head);
  file.pipe(res);
});
// 🚀 Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});