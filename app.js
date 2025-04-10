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
app.use(cors());
app.use(express.json());

// Multer Setup for File Upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'Files');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });
const RECORDS_FILE = path.join(__dirname, 'records.json');

// Upload File to Files Folder
app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({ message: 'File uploaded successfully', fileName: req.file.originalname });
});

// Commit File to Dev Branch
app.post('/git/commit/dev/all', async (req, res) => {
  const commitMessage = req?.body?.message || 'Committing all changes to dev';
  const BRANCH = 'dev';
  const REPO_PATH = path.join(__dirname);

  try {
    // 1. Get reference to the branch
    const refRes = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/ref/heads/${BRANCH}`);
    const latestCommitSha = refRes.data.object.sha;

    // 2. Get latest commit data (to get tree SHA)
    const commitRes = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/commits/${latestCommitSha}`);
    const baseTreeSha = commitRes.data.tree.sha;

    // 3. Read all files from REPO_PATH
    const files = await fsExtra.readdir(REPO_PATH);
    const blobs = [];

    for (const file of files) {
      const fullPath = path.join(REPO_PATH, file);
      const stats = await fsExtra.stat(fullPath);
      if (stats.isFile()) {
        const content = await fsExtra.readFile(fullPath, 'utf8');
        // 4. Create a blob for each file
        const blobRes = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/blobs`, {
          content,
          encoding: 'utf-8',
        });

        blobs.push({
          path: file,
          mode: '100644',
          type: 'blob',
          sha: blobRes.data.sha,
        });
      }
    }

    // 5. Create a new tree with the blobs
    const treeRes = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/trees`, {
      base_tree: baseTreeSha,
      tree: blobs,
    });

    // 6. Create a new commit
    const commitRes2 = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/commits`, {
      message: commitMessage,
      tree: treeRes.data.sha,
      parents: [latestCommitSha],
    });

    // 7. Update the ref (branch)
    await github.patch(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/refs/heads/${BRANCH}`, {
      sha: commitRes2.data.sha,
    });

    res.json({
      message: 'Committed all local changes to dev branch via GitHub API',
      commitSha: commitRes2.data.sha,
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/commit/dev', async (req, res) => {
    const { message, files = ['.'] } = req.body;
    const filePath = path.join(__dirname,'Files',files[0]);
    console.log("filePath ",filePath)
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
            path: files[0],
            mode: '100644',
            type: 'blob',
            sha: blobData.sha
          }
        ]
      });
  
      // Create commit
      const { data: newCommit } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/commits`, {
        message: message,
        tree: treeData.sha,
        parents: [latestCommitSha]
      });
  
      // Update branch reference
      await github.patch(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/git/refs/heads/${branch}`, {
        sha: newCommit.sha
      });

      //Append to records.json
      const record = {
        sha: newCommit.sha,
        file: files[0],
        message: message,
        branch: 'dev',
        date: new Date()
      };

      let records = [];
      if (await fsExtra.pathExists(RECORDS_FILE)) {
        records = await fsExtra.readJSON(RECORDS_FILE);
      }

      records.push(record);
      await fsExtra.writeJSON(RECORDS_FILE, records, { spaces: 2 });

      res.json(record);
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
    }
});

// Merge Dev to UAT
app.post('/git/promote/dev-to-uat/selected', async (req, res) => {
  try {
    const { selectedShas } = req.body; // Array of SHAs to promote (max 1 at a time via merge)

  if (!selectedShas || !Array.isArray(selectedShas) || selectedShas.length === 0) {
    return res.status(400).json({ error: 'No SHAs provided' });
  }
  
  let records = [];

  for (const sha of selectedShas) {
    try {
        const commit_essentials = {
          base: 'UAT',
          head: sha,
          commit_message: `Promote commit ${sha} to UAT`
        };
        const { data } = await github.post(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/merges`,commit_essentials);

        //Append to records.json
        const record = {
          sha: commit_essentials?.sha,
          file: "same as dev",
          message: commit_essentials?.commit_message,
          branch: commit_essentials?.head,
          date: new Date()
        };

        if (await fsExtra.pathExists(RECORDS_FILE)) {
          records = await fsExtra.readJSON(RECORDS_FILE);
        }

        records.push(record);
        await fsExtra.writeJSON(RECORDS_FILE, records, { spaces: 2 });

      }catch (err) {
        console.error(`Failed to merge ${sha}:`, err.response?.data || err.message);
        promoted.push({ sha, merged: false, error: err.message });
      }
    }

    res.json(records);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/promote/dev-to-uat', async (req, res) => {
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

// Merge UAT to Main
app.post('/git/promote/uat-to-main', async (req, res) => {
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

// Switch to Branch (get HEAD commit)
app.post('/switch-branch', async (req, res) => {
  const { branch } = req.body;
  try {
    const { data: branchData } = await github.get(`/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/branches/${branch}`);
    res.json({ message: `Switched to ${branch}`, commit: branchData.commit });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));