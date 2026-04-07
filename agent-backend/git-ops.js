const { execSync } = require("child_process");
const REPO_ROOT = "/opt/egov/ccrs-dashboard";

function exec(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function autoCommit(message) {
  try {
    exec("git add -A frontend/ utilities/");
    const status = exec("git status --porcelain frontend/ utilities/");
    if (!status) return null;
    const safe = message.replace(/"/g, '\\"').replace(/\n/g, " ");
    exec(`git commit -m "${safe}"`);
    return exec("git rev-parse --short HEAD");
  } catch (e) {
    console.error("autoCommit failed:", e.message);
    return null;
  }
}

function getLog(limit = 30) {
  try {
    const raw = exec(
      `git log --format='%h||%H||%s||%ci||%an' -n ${limit}`
    );
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, fullHash, message, date, author] = line.split("||");
        let label = null;
        try {
          const tag = execSync(
            `git tag --points-at ${hash} 2>/dev/null`,
            { cwd: REPO_ROOT, encoding: "utf-8" }
          ).trim();
          if (tag) label = tag;
        } catch {}
        return { hash, fullHash, message, date, author, label };
      });
  } catch (e) {
    console.error("getLog failed:", e.message);
    return [];
  }
}

function rollback(commitHash) {
  try {
    // Only rollback source files, not config/build files
    exec(`git checkout ${commitHash} -- frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src/ utilities/crs_dataloader/ui-mockup/src/`);
    exec("git add -A");
    const status = exec("git status --porcelain");
    if (status) {
      exec(`git commit -m "Rollback to ${commitHash}"`);
    }
    return { success: true, hash: exec("git rev-parse --short HEAD") };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function saveVersion(label, notes) {
  try {
    const safe = (notes || label).replace(/"/g, '\\"');
    exec(`git tag -a "${label}" -m "${safe}"`);
    return { success: true, label };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getStagedChanges() {
  try {
    // Find the latest tag (saved version)
    let lastTag;
    try {
      lastTag = exec("git describe --tags --abbrev=0 2>/dev/null");
    } catch {
      lastTag = null;
    }

    // Show ALL commits since last tag (not just AI ones)
    const range = lastTag ? `${lastTag}..HEAD` : "";
    if (!range) {
      // No tags — show recent commits
      const raw = exec("git log --format='%h||%s||%ci' -10 2>/dev/null");
      if (!raw) return [];
      return raw.split("\n").filter(Boolean).map((line) => {
        const [hash, message, date] = line.split("||");
        return { hash, message, date };
      });
    }

    const raw = exec(`git log ${range} --format='%h||%s||%ci' 2>/dev/null`);
    if (!raw) return [];
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, message, date] = line.split("||");
        return { hash, message, date };
      });
  } catch (e) {
    console.error("getStagedChanges failed:", e.message);
    return [];
  }
}

function discardChanges() {
  try {
    // Find the latest tag
    let lastTag;
    try {
      lastTag = exec("git describe --tags --abbrev=0 2>/dev/null");
    } catch {
      return { success: false, error: "No saved version to revert to" };
    }
    exec(`git checkout ${lastTag} -- frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src/ utilities/crs_dataloader/ui-mockup/src/`);
    exec("git add -A");
    exec(`git commit -m "Discard: reverted to ${lastTag}"`);
    return { success: true, revertedTo: lastTag };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { autoCommit, getLog, rollback, saveVersion, getStagedChanges, discardChanges };
