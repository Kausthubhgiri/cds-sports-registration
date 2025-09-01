let data = [];
const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const multer = require('multer');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const filePath = path.join(__dirname, 'results.json');

// 🔐 GitHub sync config
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'kausthubhgiri/cds-sports-registration';
const FILE_PATH = 'results.json';
const BRANCH = 'main';
const USE_GITHUB = process.env.USE_GITHUB === 'true';

// 📁 Multer config for image uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only .png and .jpg files are allowed'));
    }
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 🧠 App state

let chestRanges = {};
let chestTracker = {};

// 🔄 GitHub fetch
async function fetchDataFromGitHub() {
  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  };
  try {
    const { data: fileData } = await axios.get(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers }
    );
    const content = Buffer.from(fileData.content, 'base64').toString();
    return JSON.parse(content);
  } catch (err) {
    console.error("❌ GitHub fetch failed:", err.message);
    return [];
  }
}

// 🗂️ Local fallback
function fetchDataFromLocal() {
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    return fileData.trim() ? JSON.parse(fileData) : [];
  } catch {
    return [];
  }
}

// 🧩 Unified loader
async function getLatestData() {
  return USE_GITHUB ? await fetchDataFromGitHub() : fetchDataFromLocal();
}

// 📤 GitHub push
async function pushToGitHub(newData, message = 'Update results.json') {
  if (!GITHUB_TOKEN) {
    console.error("❌ Missing GitHub token. Cannot push to GitHub.");
    return;
  }

  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  };

  console.log("📤 Attempting GitHub push...");
  console.log(`📝 Commit message: ${message}`);
  console.log(`📦 Data size: ${JSON.stringify(newData).length} bytes`);

  let sha = null;

  try {
    const { data: fileData } = await axios.get(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
      { headers }
    );
    sha = fileData.sha;
    console.log("🔍 Existing file found. SHA:", sha);
  } catch (err) {
    if (err.response?.status === 404) {
      console.log("📁 File not found — creating new one");
    } else {
      console.error("❌ GitHub fetch failed:", err.response?.data || err.message);
      return;
    }
  }

  const payload = {
    message,
    content: Buffer.from(JSON.stringify(newData, null, 2)).toString('base64'),
    branch: BRANCH,
  };

  if (sha) payload.sha = sha;

  try {
    await axios.put(
      `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
      payload,
      { headers }
    );
    console.log("✅ GitHub push successful");
  } catch (err) {
    console.error("❌ GitHub push failed:", err.response?.data || err.message);
  }
}
// 📊 Chest number logic
async function loadChestRanges() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('chest_numbers.xlsx');
  const sheet = workbook.getWorksheet(1);
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    const school = row.getCell(1).value;
    const start = parseInt(row.getCell(2).value);
    const end = parseInt(row.getCell(3).value);
    if (school && start && end) {
      chestRanges[school] = { start, end };
      chestTracker[school] = start;
    }
  });
}

// 🔁 Recover chest tracker from data
async function initializeData() {
  data = await getLatestData();
  data.forEach(entry => {
    const school = entry.school;
    const chest = entry.chest;
    if (!chestTracker[school] || chest >= chestTracker[school]) {
      chestTracker[school] = chest + 1;
    }
  });
}
function getAgeCategory(dob) {
  const birthYear = new Date(dob).getFullYear();
  if (isNaN(birthYear)) return 'Invalid DOB';

  const age = new Date().getFullYear() - birthYear;

  if (age <= 10) return 'Under 11';
  if (age <= 13) return 'Under 14';
  if (age <= 15) return 'Under 16';
  if (age === 16) return 'Under 17';
  if (age <= 18) return 'Under 19';
  return 'Overage';
}
// 📝 Submit route
app.post('/submit', upload.single('photo'), async (req, res) => {
  const { school, name, dob, gender, events } = req.body;
  const photo = req.file;

  if (!school || !name || !dob || !gender || !events || !photo) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const normalizedName = name.trim().toLowerCase();
  const normalizedSchool = school.trim().toLowerCase();

  const duplicate = data.find(entry =>
    entry.name.trim().toLowerCase() === normalizedName &&
    entry.school.trim().toLowerCase() === normalizedSchool
  );
  if (duplicate) {
    return res.status(400).json({ error: "This participant is already registered from this school." });
  }

  const ageCategory = getAgeCategory(dob);
  const range = chestRanges[school.trim()];
  if (!range) {
    return res.status(400).json({ error: "School not found in chest number database." });
  }

  const nextChest = chestTracker[school]++;
  if (nextChest > range.end) {
    return res.status(400).json({ error: "Chest number range exhausted for this school." });
  }

  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });
  const sanitizedEvents = Array.isArray(events)
    ? events.map(e => e.trim())
    : typeof events === 'string'
      ? [events.trim()]
      : [];

  if (sanitizedEvents.length === 0) {
    return res.status(400).json({ error: "No events selected." });
  }

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

  ddata.push(entry);
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

if (USE_GITHUB) {
  await pushToGitHub(data, `Add ${name} from ${school}`);
}

  res.json({ message: "Success", chest: nextChest });
});

// 🆕 POST /results (duplicate logic for frontend compatibility)
app.post('/results', upload.single('photo'), async (req, res) => {
  const { school, name, dob, ageCategory, gender, events } = req.body;
  const photo = req.file;

  if (!school || !name || !dob || !ageCategory || !gender || !events || !photo) {
    return res.status(400).send("Missing fields");
  }

  const range = chestRanges[school];
  if (!range) return res.status(400).send("School not found in chest number database.");

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

if (USE_GITHUB) {
  await pushToGitHub(data, `Add ${name} from ${school}`);
}

  res.send("Success");
});

// 📊 GET /results
app.get('/results', async (req, res) => {
  const parsed = await getLatestData();
  const sorted = [...parsed].sort((a, b) => a.school.localeCompare(b.school));
  res.json(sorted);
});

// 📁 GET /export
app.get('/export', async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CDS Sports Results');
  const ageOrder = ["Under 11", "Under 14", "Under 16", "Under 17", "Under 19"];
  const exportData = await getLatestData();

  function groupBy(array, key) {
    return array.reduce((acc, item) => {
      const group = item[key];
      acc[group] = acc[group] || [];
      acc[group].push(item);
      return acc;
    }, {});
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
  await workbook.xlsx.write(res);
  res.end();
});

// 🔁 Reset routes
app.post('/reset-all', async (req, res) => {
  data = [];
  chestTracker = {};
  await loadChestRanges();
  USE_GITHUB
    ? await pushToGitHub([], 'Reset all responses')
    : fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  res.send("All responses have been reset.");
});

app.post('/reset-last', async (req, res) => {
  if (data.length === 0) return res.send("No responses to remove.");
  const lastEntry = data.pop();

  USE_GITHUB
    ? await pushToGitHub(data, 'Remove last response')
    : fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  const school = lastEntry.school;
  if (chestTracker[school] && chestTracker[school] > chestRanges[school].start) {
    chestTracker[school]--;
  }

  res.send("Last response and chest number have been removed.");
});

// 🏫 School routes
app.get('/schools', (req, res) => {
  const schools = [...new Set(data.map(entry => entry.school))].sort();
  res.json(schools);
});

app.get('/export-school', async (req, res) => {
  const schoolName = req.query.school;
  if (!schoolName) return res.status(400).send("School name is required.");

  const exportData = await getLatestData();
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
(async () => {
  await loadChestRanges();
  console.log("📦 Chest ranges loaded:", chestRanges);
  await initializeData();
  app.get('/next-chest', (req, res) => {
  const school = req.query.school;
  if (!school) return res.json({ chest: null });

  const normalized = school.trim().toLowerCase();

  const matchKey = Object.keys(chestRanges).find(
    key => key.trim().toLowerCase() === normalized
  );

  if (!matchKey) {
    console.log(`❌ School not found: ${school}`);
    return res.json({ chest: null });
  }

  const range = chestRanges[matchKey];
  const next = chestTracker[matchKey];

  if (!range || next > range.end) {
    console.log(`⚠️ Chest range exhausted for ${matchKey}`);
    return res.json({ chest: null });
  }
  console.log(`✅ Next chest for ${matchKey}: ${next}`);

  res.json({ chest: next });
});

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
})();
