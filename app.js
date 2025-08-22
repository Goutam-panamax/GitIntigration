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

  if (files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }

  try {
    // get base ref of branch
    const refResp = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
    const baseSha = refResp.data.object.sha;

    // get base commit (to extract tree sha)
    const baseCommitResp = await git.get(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
    const baseTreeSha = baseCommitResp.data.tree.sha;

    // build tree items for all files
    let treeItems = [];
    for (let f of files) {
      const localPath = path.join(UPLOAD_PATH, f);
      const content = fs.readFileSync(localPath, "base64");

      // create blob for file
      const blobResp = await git.post(`/repos/${OWNER}/${REPO}/git/blobs`, {
        content,
        encoding: "base64"
      });

      treeItems.push({
        path: `Files/${f}`,
        mode: "100644",
        type: "blob",
        sha: blobResp.data.sha
      });
    }

    // create new tree
    const newTreeResp = await git.post(`/repos/${OWNER}/${REPO}/git/trees`, {
      base_tree: baseTreeSha,
      tree: treeItems
    });

    // create commit
    const newCommitResp = await git.post(`/repos/${OWNER}/${REPO}/git/commits`, {
      message,
      tree: newTreeResp.data.sha,
      parents: [baseSha]
    });

    // update branch ref
    await git.patch(`/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, {
      sha: newCommitResp.data.sha,
      force: false
    });

    res.json({
      message: "Files committed",
      branch,
      commitId: newCommitResp.data.sha,
      files
    });
  } catch (err) {
    console.error("Commit error:", err.response?.data || err.message);
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
      const commitResp = await git.get(`/repos/${OWNER}/${REPO}/commits/${commitSha}`);
      const commit = commitResp.data;

      // get ref of target branch
      const refResp = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${targetBranch}`);
      const baseSha = refResp.data.object.sha;

      // get tree of base commit (target branch)
      const baseCommitResp = await git.get(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
      const baseTreeSha = baseCommitResp.data.tree.sha;

      // build tree with only changed files
      let treeItems = [];
      for (let file of commit.files) {
        if (file.status === "removed") {
          treeItems.push({
            path: file.filename,
            mode: "100644",
            type: "blob",
            sha: null
          });
        } else {
          // get blob sha from commit
          const blobResp = await git.get(
            `/repos/${OWNER}/${REPO}/contents/${file.filename}?ref=${commitSha}`
          );

          treeItems.push({
            path: file.filename,
            mode: "100644",
            type: "blob",
            sha: blobResp.data.sha
          });
        }
      }

      // create new tree
      const newTreeResp = await git.post(`/repos/${OWNER}/${REPO}/git/trees`, {
        base_tree: baseTreeSha,
        tree: treeItems
      });

      // create new commit
      const newCommitResp = await git.post(`/repos/${OWNER}/${REPO}/git/commits`, {
        message: `[Cherry-pick] ${commit.commit.message}`,
        tree: newTreeResp.data.sha,
        parents: [baseSha]
      });

      // update branch ref
      await git.patch(`/repos/${OWNER}/${REPO}/git/refs/heads/${targetBranch}`, {
        sha: newCommitResp.data.sha,
        force: false
      });

      applied.push(newCommitResp.data.sha);
    }

    res.json({ message: "Commits cherry-picked", targetBranch, applied });
  } catch (err) {
    console.error("Cherry-pick error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post("/git/cherrypick/pr", async (req, res) => {
  const { commits = [], targetBranch, prTitle = "Cherry-pick PR", prBody = "" } = req.body;

  if (!targetBranch || commits.length === 0) {
    return res.status(400).json({ error: "targetBranch and commits are required" });
  }

  try {
    // STEP 1: Get latest commit on target branch
    const refResp = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${targetBranch}`);
    const baseSha = refResp.data.object.sha;

    // STEP 2: Create a new branch for cherry-pick
    const newBranch = `cherry-pick-${Date.now()}`;
    await git.post(`/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${newBranch}`,
      sha: baseSha
    });

    let lastSha = baseSha;

    // STEP 3: Apply commits one by one into new branch
    for (let commitSha of commits) {
      const commitResp = await git.get(`/repos/${OWNER}/${REPO}/commits/${commitSha}`);
      const commit = commitResp.data;

      const baseCommitResp = await git.get(`/repos/${OWNER}/${REPO}/git/commits/${lastSha}`);
      const baseTreeSha = baseCommitResp.data.tree.sha;

      let treeItems = [];
      for (let file of commit.files) {
        if (file.status === "removed") {
          treeItems.push({
            path: file.filename,
            mode: "100644",
            type: "blob",
            sha: null
          });
        } else {
          const blobResp = await git.get(
            `/repos/${OWNER}/${REPO}/contents/${file.filename}?ref=${commitSha}`
          );

          treeItems.push({
            path: file.filename,
            mode: "100644",
            type: "blob",
            sha: blobResp.data.sha
          });
        }
      }

      const newTreeResp = await git.post(`/repos/${OWNER}/${REPO}/git/trees`, {
        base_tree: baseTreeSha,
        tree: treeItems
      });

      const newCommitResp = await git.post(`/repos/${OWNER}/${REPO}/git/commits`, {
        message: `[Cherry-pick] ${commit.commit.message}`,
        tree: newTreeResp.data.sha,
        parents: [lastSha]
      });

      await git.patch(`/repos/${OWNER}/${REPO}/git/refs/heads/${newBranch}`, {
        sha: newCommitResp.data.sha,
        force: false
      });

      lastSha = newCommitResp.data.sha;
    }

    // STEP 4: Create PR
    const prResp = await git.post(`/repos/${OWNER}/${REPO}/pulls`, {
      title: prTitle,
      head: newBranch,
      base: targetBranch,
      body: prBody
    });

    res.json({
      message: "Cherry-pick PR created",
      prUrl: prResp.data.html_url,
      prNumber: prResp.data.number,
      branch: newBranch
    });
  } catch (err) {
    console.error("Cherry-pick PR error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.post("/git/cherrypick/approve", async (req, res) => {
  const { prNumber, mergeMethod = "merge" } = req.body;

  if (!prNumber) {
    return res.status(400).json({ error: "prNumber is required" });
  }

  try {
    // STEP 1: Approve PR (GitHub API requires a review submission)
    await git.post(`/repos/${OWNER}/${REPO}/pulls/${prNumber}/reviews`, {
      event: "APPROVE",
      body: "Auto-approved by system"
    });

    // STEP 2: Merge PR
    const mergeResp = await git.put(`/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, {
      merge_method: mergeMethod
    });

    res.json({
      message: "PR approved and merged",
      mergeCommitSha: mergeResp.data.sha
    });
  } catch (err) {
    console.error("Approve PR error:", err.response?.data || err.message);
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

// Create a new branch with safety check
app.post("/git/branch", async (req, res) => {
  const { branch, baseBranch = "dev" } = req.body;

  if (!branch) {
    return res.status(400).json({ error: "branch is required" });
  }

  try {
    // Step 0: Check if branch already exists
    try {
      await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`);
      return res.status(400).json({ error: `Branch '${branch}' already exists` });
    } catch (err) {
      if (err.response?.status !== 404) {
        throw err; // only ignore 404, rethrow others
      }
    }

    // Step 1: Get the latest commit SHA from the base branch
    const baseRefResp = await git.get(`/repos/${OWNER}/${REPO}/git/ref/heads/${baseBranch}`);
    const latestSha = baseRefResp.data.object.sha;

    // Step 2: Create new branch reference
    const createRefResp = await git.post(`/repos/${OWNER}/${REPO}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: latestSha
    });

    res.json({
      message: `Branch '${branch}' created from '${baseBranch}'`,
      branch: branch,
      sha: createRefResp.data.object.sha
    });
  } catch (err) {
    console.error("Branch creation error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Protect a branch (require PRs, block direct pushes)
app.post("/git/protect-branch", async (req, res) => {
  const { branch } = req.body;

  if (!branch) {
    return res.status(400).json({ error: "branch is required" });
  }

  try {
    const resp = await git.put(
      `/repos/${OWNER}/${REPO}/branches/${branch}/protection`,
      {
        required_status_checks: null, // you can set specific CI checks here
        enforce_admins: true,        // even admins must follow rules
        required_pull_request_reviews: {
          required_approving_review_count: 1, // require at least 1 approval
          dismiss_stale_reviews: true
        },
        restrictions: null // if you want to restrict which users/teams can push
      },
      {
        headers: {
          Accept: "application/vnd.github.luke-cage-preview+json" // required header for branch protection API
        }
      }
    );

    res.json({
      message: `Branch '${branch}' is now protected`,
      protection: resp.data
    });
  } catch (err) {
    console.error("Branch protection error:", err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));