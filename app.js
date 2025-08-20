// app.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
require('dotenv').config();
const git = require('./githubClient');

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

      const resp = await git.put(`/repos/${OWNER}/${REPO}/contents/Files/${f}`, {
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
      // 1. Get commit details (includes list of changed files)
      const commitResp = await git.get(`/repos/${OWNER}/${REPO}/commits/${commitSha}`);
      const commit = commitResp.data;

      // 2. Get latest commit of target branch
      const refResp = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${targetBranch}`);
      const baseSha = refResp.data.object.sha;
      const baseCommit = await git.get(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
      const baseTreeSha = baseCommit.data.tree.sha;

      // 3. Prepare tree changes only for files in this commit
      let treeItems = [];
      for (let file of commit.files) {
        if (file.status === "removed") {
          treeItems.push({
            path: file.filename,
            mode: "100644",
            sha: null // mark for deletion
          });
        } else {
          // fetch blob contents from GitHub
          const blobResp = await git.get(`/repos/${OWNER}/${REPO}/git/blobs/${file.sha}`);
          const content = Buffer.from(blobResp.data.content, "base64").toString("utf-8");

          treeItems.push({
            path: file.filename,
            mode: "100644",
            type: "blob",
            content
          });
        }
      }

      // 4. Create a new tree on top of target branch tree
      const newTreeResp = await git.post(`/repos/${OWNER}/${REPO}/git/trees`, {
        base_tree: baseTreeSha,
        tree: treeItems
      });

      // 5. Create new commit with that tree
      const newCommitResp = await git.post(`/repos/${OWNER}/${REPO}/git/commits`, {
        message: `[Cherry-pick] ${commit.commit.message}`,
        tree: newTreeResp.data.sha,
        parents: [baseSha]
      });

      // 6. Update target branch to point to new commit
      await git.patch(`/repos/${OWNER}/${REPO}/git/refs/heads/${targetBranch}`, {
        sha: newCommitResp.data.sha,
        force: false
      });

      applied.push(newCommitResp.data.sha);
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
      await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
    } catch (e) {
      // branch doesn't exist → create from current
      const ref = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${CURRENT_BRANCH}`);
      await git.post(`/repos/${OWNER}/${REPO}/git/refs`, {
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