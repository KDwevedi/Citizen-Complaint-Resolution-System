const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolveContext } = require("./context-map");
const { autoCommit, getLog, rollback, saveVersion } = require("./git-ops");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = 4100;
const REPO_ROOT = "/opt/egov/ccrs-dashboard";
// System prompt loaded via --system-prompt-file flag

function describeToolAction(tool, file) {
  const f = file ? ` ${file}` : "";
  switch (tool) {
    case "Read": return `Reading${f}`;
    case "Edit": return `Editing${f}`;
    case "Write": return `Writing${f}`;
    case "Glob": return `Searching files${f}`;
    case "Grep": return `Searching code${f}`;
    case "Bash": return `Running command${f}`;
    default:
      if (tool.startsWith("mcp__DIGIT")) {
        const mcpTool = tool.split("__").pop();
        return `Querying ${mcpTool}`;
      }
      return tool || "Working...";
  }
}

// Mutex: only one Claude subprocess at a time
let busy = false;
const queue = [];

function acquireLock() {
  return new Promise((resolve) => {
    if (!busy) {
      busy = true;
      resolve();
    } else {
      queue.push(resolve);
    }
  });
}

function releaseLock() {
  if (queue.length > 0) {
    const next = queue.shift();
    next();
  } else {
    busy = false;
  }
}

// POST /api/agent/chat — main chat endpoint, returns SSE stream
app.post("/api/agent/chat", async (req, res) => {
  const { message, context = {} } = req.body;
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  await acquireLock();
  sendEvent({ type: "status", content: "Thinking..." });

  try {
    // Resolve route context
    const routeContext = resolveContext(context.currentRoute || "");

    // Build conversation history for context
    const history = (context.conversationHistory || [])
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    // Build the full prompt
    const prompt = [
      "## Current Page Context",
      `Route: ${context.currentRoute || "unknown"}`,
      `Page: ${routeContext.description}`,
      "",
      "## Relevant Files (focus your edits here)",
      ...routeContext.relevantFiles.map((f) => `- ${f}`),
      "",
      "## Shared Files (for reference)",
      ...routeContext.sharedFiles.map((f) => `- ${f}`),
      "",
      history ? `## Conversation History\n${history}\n` : "",
      "## User Request",
      message,
    ]
      .filter(Boolean)
      .join("\n");

    // Spawn claude subprocess
    const claude = spawn(
      "claude",
      [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--system-prompt-file",
        path.join(__dirname, "system-prompt.md"),
        "--mcp-config",
        '{"mcpServers":{}}',
        "--strict-mcp-config",
        "--allowedTools",
        "Edit,Read,Write,Glob,Grep,Bash",
        "--max-turns",
        "10",
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let fullResponse = "";
    let buffer = "";

    claude.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === "assistant" && event.message) {
            for (const block of event.message.content || []) {
              if (block.type === "text") {
                fullResponse += block.text;
                sendEvent({ type: "text", content: block.text });
              } else if (block.type === "thinking") {
                // Send thinking indicator
                const snippet = (block.thinking || "").slice(0, 80);
                sendEvent({ type: "status", content: "Thinking...", detail: snippet });
              } else if (block.type === "tool_use") {
                // Tool use from assistant message — extract file path
                const toolName = block.name || "";
                const input = block.input || {};
                const filePath = input.file_path || input.path || input.pattern || input.command || "";
                const shortPath = filePath.split("/").slice(-2).join("/");
                const label = describeToolAction(toolName, shortPath);
                sendEvent({ type: "tool_use", tool: toolName, label, file: shortPath });
              }
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") {
              fullResponse += event.delta.text;
              sendEvent({ type: "text", content: event.delta.text });
            } else if (event.delta?.type === "thinking_delta") {
              // Streaming thinking — send periodic status
              const snippet = (event.delta.thinking || "").slice(0, 80);
              if (snippet.length > 10) {
                sendEvent({ type: "status", content: "Thinking...", detail: snippet });
              }
            }
          } else if (event.type === "content_block_start") {
            if (event.content_block?.type === "tool_use") {
              const toolName = event.content_block.name || "";
              sendEvent({ type: "tool_use", tool: toolName, label: describeToolAction(toolName, ""), file: "" });
            } else if (event.content_block?.type === "thinking") {
              sendEvent({ type: "status", content: "Thinking..." });
            }
          } else if (event.type === "result") {
            // Final result — text already sent via assistant events
          }
        } catch {
          // Not JSON, skip
        }
      }
    });

    claude.stderr.on("data", (chunk) => {
      const msg = chunk.toString();
      if (msg.includes("error") || msg.includes("Error")) {
        console.error("claude stderr:", msg);
      }
    });

    claude.on("close", (code) => {
      // Auto-commit any changes
      const shortMsg =
        message.length > 60 ? message.slice(0, 57) + "..." : message;
      const commitHash = autoCommit(`AI: ${shortMsg}`);

      sendEvent({
        type: "done",
        commitHash: commitHash,
        exitCode: code,
      });

      res.end();
      releaseLock();
    });

    claude.on("error", (err) => {
      sendEvent({ type: "error", content: err.message });
      res.end();
      releaseLock();
    });

    // Handle client disconnect
    req.on("close", () => {
      claude.kill("SIGTERM");
      releaseLock();
    });
  } catch (err) {
    sendEvent({ type: "error", content: err.message });
    res.end();
    releaseLock();
  }
});

// GET /api/agent/versions — git log
app.get("/api/agent/versions", (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  res.json(getLog(limit));
});

// POST /api/agent/save-version — create labeled git tag
app.post("/api/agent/save-version", (req, res) => {
  const { label, notes } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });
  res.json(saveVersion(label, notes));
});

// POST /api/agent/rollback — checkout a previous version
app.post("/api/agent/rollback", (req, res) => {
  const { commitHash } = req.body;
  if (!commitHash)
    return res.status(400).json({ error: "commitHash is required" });
  res.json(rollback(commitHash));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Agent backend running on http://0.0.0.0:${PORT}`);
  console.log(`Repo root: ${REPO_ROOT}`);
});
