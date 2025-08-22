const express = require('express');
const simpleGit = require('simple-git');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const github = require('./githubClient');

const app = express();
const PORT = 3000;

// ✅ Enable CORS for all APIs
app.use(cors());

// ✅ Parse JSON bodies
app.use(bodyParser.json());

// ✅ Configure Git Repo Path
const repoPath = path.resolve(__dirname); // root directory
const git = simpleGit(repoPath);

// Create Files directory if it doesn't exist
const filesDir = path.join(__dirname, 'Files');
if (!fs.existsSync(filesDir)) {
  fs.mkdirSync(filesDir);
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'Files/');
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Save with original name
  }
});

const upload = multer({ storage });

//Test API
app.post('/', async (req, res) => {
    try {
      res.json({ success: true, message: 'Request Recieved in Test Run.',Data: req.body });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
});

// ==============================
// 🚀 API 0: Upload API
// ==============================
app.post('/upload-file', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');
    return res.json({ message: 'File uploaded successfully', file: req.file.filename });
  });

// ==============================
// 🚀 API 1: Commit to dev Branch
// ==============================
app.post('/git/commit/dev/all', async (req, res) => {
  const { message = "Auto commit to Dev" } = req.body;

  try {
    // Checkout dev branch and pull latest
    await git.checkout('dev');
    await git.pull('origin', 'dev');

    // Stage all changes (added, modified, deleted)
    await git.add('./*'); // or git.add('.')

    // Commit all staged changes
    const commitResult = await git.commit(message);

    // Push to dev branch
    await git.push('origin', 'dev');

    res.json({
      message: 'All changes committed and pushed to dev branch.',
      commit: commitResult.commit,
    });
  } catch (err) {
    console.error('Commit Error:', err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/git/commit/dev', async (req, res) => {
  const { message, files = ['.'] } = req.body;

  try {
    await git.checkout('dev');
    await git.pull('origin', 'dev');
    await git.add(files);
    await git.commit(message);
    await git.push('origin', 'dev');

    res.json({ success: true, message: 'Changes committed to dev branch.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================
// 🚀 API 2: Promote dev ➝ UAT
// ======================================
app.post('/git/promote/dev-to-uat/selective', async (req, res) => {
  try {
    await git.fetch();
    await git.checkout('UAT');
    await git.pull('origin', 'UAT');

    for (const sha of commitShas) {
      await git.cherryPick(sha);
    }

    await git.push('origin', 'UAT');
    res.json({ message: 'Selected commits promoted to UAT.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/git/promote/dev-to-uat', async (req, res) => {
  try {
    await git.checkout('UAT');
    await git.pull('origin', 'UAT');
    await git.mergeFromTo('dev', 'UAT');
    await git.push('origin', 'UAT');

    res.json({ success: true, message: 'Merged dev into UAT successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================
// 🚀 API 3: Promote UAT ➝ main
// ======================================
app.post('/git/promote/uat-to-main', async (req, res) => {
  try {
    await git.checkout('main');
    await git.pull('origin', 'main');
    await git.mergeFromTo('UAT', 'main');
    await git.push('origin', 'main');

    res.json({ success: true, message: 'Merged UAT into main successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =======================================
// 🚀 API 4: Get Git Logs from a Branch
// =======================================
app.get('/git/logs/:branch', async (req, res) => {
  const { branch } = req.params;

  try {
    await git.checkout(branch);
    await git.pull('origin', branch);
    const logs = await git.log({ n: 50 });

    res.json({ success: true, branch, logs: logs.all });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================================================
// 🚀 API 5: Get Git Logs by User from a Branch
// ==================================================
app.get('/git/logs/:branch/user/:username', async (req, res) => {
  const { branch, username } = req.params;

  try {
    await git.checkout(branch);
    await git.pull('origin', branch);

    const logs = await git.log({ n: 100 });

    const userCommits = logs.all.filter(commit =>
      commit.author_name.toLowerCase().includes(username.toLowerCase()) ||
      commit.author_email.toLowerCase().includes(username.toLowerCase())
    );

    res.json({
      success: true,
      branch,
      username,
      total: userCommits.length,
      commits: userCommits
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 🚀 API 6: Switch to a Specific Branch
// ==========================================
app.post('/git/switch', async (req, res) => {
    const { branch } = req.body;
  
    if (!branch) {
      return res.status(400).json({ success: false, message: 'branch is required in the request body.' });
    }
  
    try {
      // Check if the branch exists
      const branches = await git.branch();
      const branchExists = branches.all.includes(branch);
  
      if (!branchExists) {
        return res.status(404).json({ success: false, message: `Branch '${branch}' does not exist.` });
      }
  
      // Switch to the specified branch
      await git.checkout(branch);
      await git.pull('origin', branch);
  
      res.json({ success: true, message: `Switched to branch '${branch}' and pulled latest changes.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Git API server running at http://localhost:${PORT}`);
});
