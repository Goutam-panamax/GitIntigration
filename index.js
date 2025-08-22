const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const simpleGit = require("simple-git");

const app = express();
app.use(express.json());

const REPO_PATH = path.resolve(__dirname); // constant repo folder
const UPLOAD_PATH = path.join(REPO_PATH, "Files"); // files stored here
const git = simpleGit(REPO_PATH);

// ensure repo and upload folder exist
if (!fs.existsSync(REPO_PATH)) fs.mkdirSync(REPO_PATH);
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH);

// configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_PATH),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

/**
 * 1. Upload file
 */
app.post("/upload-file", upload.single("file"), async (req, res) => {
    try {
        res.json({ message: "File uploaded successfully", file: req.file.filename });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 2. Commit uploaded file(s) to current branch
 */
app.post("/git/commit", async (req, res) => {
    const { message = "Commit from API", files = [] } = req.body;

    try {
        // Git wants POSIX-style paths (forward slashes)
        const filePaths = files.length > 0
            ? files.map(f => `Files/${f}`)   // relative to repo root
            : ["Files"];
        console.log("filePaths ", filePaths)
        await git.add(filePaths);
        await git.commit(message);

        // latest commit hash
        const log = await git.log({ n: 1 });
        const commitId = log.latest.hash;

        res.json({
            message: "Files committed",
            commitMessage: message,
            commitId
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


/**
 * 3. Cherry-pick commits from current branch into another branch
 */
app.post("/git/cherrypick", async (req, res) => {
    const { commits = [], targetBranch } = req.body;

    if (!targetBranch || commits.length === 0) {
        return res.status(400).json({ error: "targetBranch and commits are required" });
    }
    console.log("targetBranch ",targetBranch)
    try {
        const currentBranch = (await git.branch()).current;

        // checkout target branch
        await git.checkout(targetBranch);

        // cherry-pick each commit
        // for (let c of commits) {
        //     try {
        //         await git.raw(["cherry-pick", c]);
        //     } catch (err) {
        //         // abort the cherry-pick if there’s a conflict
        //         await git.raw(["cherry-pick", "--abort"]);
        //         throw new Error(`Cherry-pick failed for commit ${c}: ${err.message}`);
        //     }
        // }
        for (let c of commits) {
            try {
                await git.raw(["cherry-pick", c]);
            } catch (err) {
                if (err.message.includes("previous cherry-pick is now empty")) {
                    // allow empty commit
                    await git.raw(["commit", "--allow-empty", "-m", `Cherry-pick empty ${c}`]);
                } else {
                    await git.raw(["cherry-pick", "--abort"]);
                    throw err;
                }
            }
        }

        // switch back to original branch
        await git.checkout(currentBranch);

        res.json({ message: "Commits cherry-picked", targetBranch, commits });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 4. Change current branch
 */
app.post("/git/switch", async (req, res) => {
    const { branch } = req.body;

    if (!branch) return res.status(400).json({ error: "branch is required" });

    try {
        const branches = await git.branch();
        if (!branches.all.includes(branch)) {
            // create branch if it doesn't exist
            await git.checkoutLocalBranch(branch);
        } else {
            await git.checkout(branch);
        }

        res.json({ message: `Switched to branch ${branch}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
