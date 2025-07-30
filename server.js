const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const multer = require('multer');

const app = express();
const PORT = 3000;
const filePath = path.join(__dirname, 'results.json');
const uploadDir = path.join(__dirname, 'uploads');

// 🧳 Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    fs.mkdirSync(uploadDir, { recursive: true }); // Ensure folder exists
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname) || ".png";
    const sanitizedName = file.originalname.replace(/\s+/g, '_');
    cb(null, `${timestamp}_${sanitizedName}`);
  }
});
const upload = multer({ storage });

let data = [];

// 🔄 Load existing entries from results.json
try {
  const fileData = fs.readFileSync(filePath, 'utf8');
  data = fileData.trim() ? JSON.parse(fileData) : [];
  console.log(`🟢 Loaded ${data.length} entries`);
} catch (err) {
  console.log("⚠️ results.json not found or unreadable. Starting fresh.");
  data = [];
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// 📝 Form submission with image upload
app.post('/results', upload.single('photo'), (req, res) => {
  const { school, name, chest, dob, gender, ageCategory, events, category } = req.body;

  if (!school || !name || !ageCategory || (!events && !category)) {
    return res.status(400).send("Missing required fields");
  }

  const categories = events
    ? Array.isArray(events) ? events : [events]
    : category ? category.split(',').map(c => c.trim()) : [];

  const photoPath = req.file ? `/uploads/${req.file.filename}` : "";

  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  categories.forEach(cat => {
    data.push({
      school,
      name,
      chest: chest || "",
      dob: dob || "",
      gender: gender || "",
      category: cat,
      ageCategory,
      timestamp,
      photo: photoPath
    });
  });

  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ message: "Entry saved successfully!" });
  } catch (err) {
    console.error("❌ Error writing to results.json:", err);
    res.status(500).json({ error: "Failed to save entry." });
  }
});

// 🆕 Legacy submit route
app.post('/submit', (req, res) => {
  const { school, name, category, ageCategory } = req.body;
  if (!school || !name || !category || !ageCategory) return res.status(400).send("Missing fields");

  const categories = category.split(',').map(c => c.trim());
  const timestamp = new Date().toLocaleString('en-IN', { hour12: false });

  categories.forEach(cat => {
    data.push({ school, name, category: cat, ageCategory, timestamp });
  });

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("Success");
});

// 📊 Sorted results
app.get('/results', (req, res) => {
  const ageOrder = ["Under 11", "Under 14", "Under 16", "Under 17", "Under 19"];
  const sorted = [...data].sort((a, b) => {
    const ageCompare = ageOrder.indexOf(a.ageCategory) - ageOrder.indexOf(b.ageCategory);
    return ageCompare !== 0 ? ageCompare : a.school.localeCompare(b.school);
  });
  res.json(sorted);
});

// 📁 Export grouped Excel
app.get('/export', (req, res) => {
  const grouped = {};

  data.forEach(entry => {
    const { school, category: event, ageCategory } = entry;
    if (!grouped[school]) grouped[school] = {};
    if (!grouped[school][event]) grouped[school][event] = {};
    if (!grouped[school][event][ageCategory]) grouped[school][event][ageCategory] = [];
    grouped[school][event][ageCategory].push(entry);
  });

  const rows = [];

  for (const school in grouped) {
    rows.push({ School: school });
    for (const event in grouped[school]) {
      rows.push({ Event: event });
      for (const ageCategory in grouped[school][event]) {
        rows.push({ AgeCategory: ageCategory });
        rows.push({
          Name: "Name",
          Chest: "Chest",
          DOB: "Date of Birth",
          Gender: "Gender",
          AgeCategory: "Age Category",
          Event: "Event",
          School: "School",
          Timestamp: "Timestamp",
          Photo: "Photo URL"
        });
        grouped[school][event][ageCategory].forEach(entry => {
          rows.push({
            Name: entry.name,
            Chest: entry.chest || "",
            DOB: entry.dob || "",
            Gender: entry.gender || "",
            AgeCategory: entry.ageCategory,
            Event: entry.category,
            School: entry.school,
            Timestamp: entry.timestamp,
            Photo: entry.photo || ""
          });
        });
      }
    }
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Grouped Results');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=grouped_results.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// 🔁 Reset routes
app.post('/reset-all', (req, res) => {
  data = [];
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.send("All responses have been reset.");
});

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