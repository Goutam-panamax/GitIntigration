const express = require('express');
const simpleGit = require('simple-git');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// ✅ Enable CORS for all APIs
app.use(cors());

// ✅ Parse JSON bodies
app.use(bodyParser.json());

// ✅ Configure Git Repo Path
const git = simpleGit(path.resolve(__dirname, './your-repo-path-here'));

// ==============================
// 🚀 API 1: Commit to Dev Branch
// ==============================
app.post('/git/commit/dev', async (req, res) => {
  const { message, files = ['.'] } = req.body;

  try {
    await git.checkout('Dev');
    await git.pull('origin', 'Dev');
    await git.add(files);
    await git.commit(message);
    await git.push('origin', 'Dev');

    res.json({ success: true, message: 'Changes committed to Dev branch.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================
// 🚀 API 2: Promote Dev ➝ UAT
// ======================================
app.post('/git/promote/dev-to-uat', async (req, res) => {
  try {
    await git.checkout('UAT');
    await git.pull('origin', 'UAT');
    await git.mergeFromTo('Dev', 'UAT');
    await git.push('origin', 'UAT');

    res.json({ success: true, message: 'Merged Dev into UAT successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================
// 🚀 API 3: Promote UAT ➝ Main
// ======================================
app.post('/git/promote/uat-to-main', async (req, res) => {
  try {
    await git.checkout('Main');
    await git.pull('origin', 'Main');
    await git.mergeFromTo('UAT', 'Main');
    await git.push('origin', 'Main');

    res.json({ success: true, message: 'Merged UAT into Main successfully.' });
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
  

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Git API server running at http://localhost:${PORT}`);
});
