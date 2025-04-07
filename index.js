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

// 🚀 Upload API
app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  return res.json({ message: 'File uploaded successfully', file: req.file.filename });
});

// ==============================
// 🚀 API 0: Test Run API
// ==============================
app.post('/', async (req, res) => {
    try {
      res.json({ success: true, message: 'Request Recieved in Test Run.',Data: req.body });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ==============================
// 🚀 API 1: Commit to dev Branch
// ==============================
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

//GIT API
app.post('/api/commit-to-dev', async (req, res) => {
    const filePath = path.join(__dirname, 'Files', req.body.fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    const branch = 'dev';
  
    try {
      const { data: refData } = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/ref/heads/${branch}`);
      const latestCommitSha = refData.object.sha;
  
      const { data: commitData } = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/commits/${latestCommitSha}`);
      const baseTree = commitData.tree.sha;
  
      // Create blob (file content)
      const { data: blobData } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/blobs`, {
        content: content,
        encoding: 'utf-8'
      });
  
      // Create tree
      const { data: treeData } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/trees`, {
        base_tree: baseTree,
        tree: [
          {
            path: `Files/${req.body.fileName}`,
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          }
        ]
      });
  
      // Create commit
      const { data: newCommit } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/commits`, {
        message: `Add ${req.body.fileName} to dev`,
        tree: treeData.sha,
        parents: [latestCommitSha]
      });
  
      // Update branch reference
      await github.patch(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/refs/heads/${branch}`, {
        sha: newCommit.sha
      });
  
      res.json({ message: `File committed to ${branch} branch` });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
    }
});

// ======================================
// 🚀 API 2: Promote dev ➝ UAT
// ======================================
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

//GIT API
app.post('/api/promote/dev-to-uat', async (req, res) => {
    try {
      const { data } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/merges`, {
        base: 'UAT',
        head: 'dev',
        commit_message: 'Merging dev into UAT'
      });
  
      res.json({ message: 'dev merged into UAT', merge_commit_sha: data.sha });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
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

//GIT API
app.post('/api/promote/uat-to-main', async (req, res) => {
    try {
      const { data } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/merges`, {
        base: 'main',
        head: 'UAT',
        commit_message: 'Merging UAT into main'
      });
  
      res.json({ message: 'UAT merged into main', merge_commit_sha: data.sha });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
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
    const { branchName } = req.body;
  
    if (!branchName) {
      return res.status(400).json({ success: false, message: 'branchName is required in the request body.' });
    }
  
    try {
      // Check if the branch exists
      const branches = await git.branch();
      const branchExists = branches.all.includes(branchName);
  
      if (!branchExists) {
        return res.status(404).json({ success: false, message: `Branch '${branchName}' does not exist.` });
      }
  
      // Switch to the specified branch
      await git.checkout(branchName);
      await git.pull('origin', branchName);
  
      res.json({ success: true, message: `Switched to branch '${branchName}' and pulled latest changes.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
});

//GIT API
app.post('/api/switch', async (req, res) => {
    const { branch } = req.body;
  
    try {
      const { data: branchData } = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/branches/${branch}`);
      res.json({ message: `Switched to ${branch}`, commit: branchData.commit });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
    }
});
  

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Git API server running at http://localhost:${PORT}`);
});
