// app.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
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

// Upload File to Files Folder
app.post('/upload-file', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({ message: 'File uploaded successfully', fileName: req.file.originalname });
});

// Commit File to Dev Branch
app.post('/git/commit/dev', async (req, res) => {
    const { message, files = ['.'] } = req.body;
    const filePath = path.join(__dirname,files[0]);
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
  
      res.json({ message: `File committed to ${branch} branch` });
    } catch (err) {
      console.error(err.response?.data || err.message);
      res.status(500).json({ error: err.message });
    }
});

// Merge Dev to UAT
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