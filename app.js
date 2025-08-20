// app.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
require('dotenv').config();
const github = require('./githubClient');

const app = express();
app.use(express.json());

// GitHub repo info
const OWNER = process.env.GITHUB_OWNER;  // e.g. "myorg"
const REPO = process.env.GITHUB_REPO;    // e.g. "myrepo"
const REPO_PATH = path.resolve(__dirname); // constant repo folder
const UPLOAD_PATH = path.join(REPO_PATH, "Files"); // files stored here

// ensure repo and upload folder exist
if (!fs.existsSync(REPO_PATH)) fs.mkdirSync(REPO_PATH);
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH);

// configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_PATH),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Upload File to Files Folder
app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({ message: 'File uploaded successfully', fileName: req.file.originalname });
});

app.post("/git/commit", async (req, res) => {
  const { message = "Commit from API", files = [], branch = "main" } = req.body;

  try {
    let committedFiles = [];
    for (let f of files) {
      const localPath = path.join(UPLOAD_PATH, f);
      const content = fs.readFileSync(localPath, "base64");

      const resp = await github.put(`/repos/${OWNER}/${REPO}/contents/Files/${f}`, {
        message,
        content,
        branch
      });

      committedFiles.push({
        file: f,
        commitId: resp.data.commit.sha
      });
    }

    res.json({ message: "Files committed", committedFiles, branch });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post("/git/cherrypick", async (req, res) => {
  const { commits = [], targetBranch } = req.body;

  if (!targetBranch || commits.length === 0) {
    return res.status(400).json({ error: "targetBranch and commits are required" });
  }

  try {
    let applied = [];

    for (let commitSha of commits) {
      // get commit details
      const commitResp = await github.get(`/repos/${OWNER}/${REPO}/commits/${commitSha}`);
      const commit = commitResp.data;

      // get ref of target branch
      const refResp = await github.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${targetBranch}`);
      const baseSha = refResp.data.object.sha;

      // create new commit with same tree
      const newCommit = await github.post(`/repos/${OWNER}/${REPO}/git/commits`, {
        message: `[Cherry-pick] ${commit.commit.message}`,
        tree: commit.commit.tree.sha,
        parents: [baseSha]
      });

      // update branch ref to new commit
      await github.patch(`/repos/${OWNER}/${REPO}/git/refs/heads/${targetBranch}`, {
        sha: newCommit.data.sha,
        force: false
      });

      applied.push(newCommit.data.sha);
    }

    res.json({ message: "Commits cherry-picked", targetBranch, applied });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post("/git/switch", async (req, res) => {
  const { branch,currentBranch } = req.body;
  let CURRENT_BRANCH = currentBranch ?? "dev";
  if (!branch) return res.status(400).json({ error: "branch is required" });

  try {
    // check if branch exists
    try {
      await github.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
    } catch (e) {
      // branch doesn't exist → create from current
      const ref = await github.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${CURRENT_BRANCH}`);
      await github.post(`/repos/${OWNER}/${REPO}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: ref.data.object.sha
      });
    }

    CURRENT_BRANCH = branch;
    res.json({ message: `Switched to branch ${branch}`, currentBranch: CURRENT_BRANCH });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));