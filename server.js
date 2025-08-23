// Add this at the top if using local dev
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const multer = require('multer');
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = 'kausthubhgiri/cds-sports-registration';
const FILE_PATH = 'results.json';
const BRANCH = 'main';
const USE_GITHUB = process.env.USE_GITHUB === 'true';

const app = express();
const PORT = process.env.PORT || 3000;
const filePath = path.join(__dirname, 'results.json');

const upload = multer({ dest: 'uploads/' });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

let data = [];
let chestRanges = {};
let chestTracker = {};

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

function fetchDataFromLocal() {
  try {
    const fileData = fs.readFileSync(filePath, 'utf8');
    return fileData.trim() ? JSON.parse(fileData) : [];
  } catch {
    return [];
  }
}

async function getLatestData() {
  return USE_GITHUB ? await fetchDataFromGitHub() : fetchDataFromLocal();
}

async function pushToGitHub(newData, message = 'Update results.json') {
  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
  };
  const { data: fileData } = await axios.get(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers }
  );
  await axios.put(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`,
    {
      message,
      content: Buffer.from(JSON.stringify(newData, null, 2)).toString('base64'),
      sha: fileData.sha,
      branch: BRANCH,
    },
    { headers }
  );
}

async function loadChestRanges() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('chest_numbers.xlsx');
  const sheet = workbook.getWorksheet(1);
  sheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return;
    const school = row.getCell(1).value;
    const start = parseInt(row.getCell(2).value);
    const end = parseInt(row.getCell(3).value);
    chestRanges[school] = { start, end };
    if (!chestTracker[school]) chestTracker[school] = start;
  });
}

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
  const age = new Date().getFullYear() - birthYear;
  if (age <= 10) return 'Under 11';
  if (age <= 13) return 'Under 14';
  if (age <= 15) return 'Under 16';
  if (age === 16) return 'Under 17';
  if (age <= 18) return 'Under 19';
  return 'Overage';
}

await loadChestRanges();
await initializeData();

// /submit and /results routes already implemented above...

app.get('/results', async (req, res) => {
  const parsed = await getLatestData();
  const sorted = [...parsed].sort((a, b) => a.school.localeCompare(b.school));
  res.json(sorted);
});

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

app.post('/reset-all', async (req, res) => {
  data = [];
  if (USE_GITHUB) {
    try {
      await pushToGitHub([], 'Reset all responses');
    } catch (err) {
      console.error("❌ GitHub reset failed:", err.message);
      return res.status(500).send("Failed to reset GitHub data");
    }
  } else {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
  res.send("All responses have been reset.");
});

app.post('/reset-last', async (req, res) => {
  if (data.length === 0) return res.send("No responses to remove.");
  const lastEntry = data.pop();

  if (USE_GITHUB) {
    try {
      await pushToGitHub(data, 'Remove last response');
    } catch (err) {
      console.error("❌ GitHub reset failed:", err.message);
      return res.status(500).send("Failed to reset GitHub data");
    }
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  const school = lastEntry.school;
  if (chestTracker[school] && chestTracker[school] > chestRanges[school].start) {
    chestTracker[school]--;
  }

  res.send("Last response and chest number have been removed.");
});

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
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});