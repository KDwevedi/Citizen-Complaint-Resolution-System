const { execSync } = require("child_process");
const REPO_ROOT = "/opt/egov/ccrs-dashboard";

function exec(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

function autoCommit(message) {
  try {
    exec("git add -A frontend/");
    const status = exec("git status --porcelain frontend/");
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
    exec(
      `git checkout ${commitHash} -- frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src/`
    );
    exec("git add -A frontend/");
    exec(`git commit -m "Rollback to ${commitHash}"`);
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

module.exports = { autoCommit, getLog, rollback, saveVersion };
