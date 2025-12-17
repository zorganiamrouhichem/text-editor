const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map(); // ws -> { name, file }
const files = new Map(); // filename -> { doc, clients:Set }

// Serve client.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

function broadcastUserList() {
  const userList = Array.from(users.values()).map(user => ({
    name: user.name,
    editingFile: user.file
  }));
  const msg = JSON.stringify({ type: "user-list", users: userList });
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

function broadcastActiveEditors(file) {
  if (!file) return;
  const fileData = files.get(file);
  if (!fileData) return;
  const editors = Array.from(fileData.clients)
    .map(ws => users.get(ws)?.name)
    .filter(name => name);
  const msg = JSON.stringify({ type: "active-editors", editors });
  fileData.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

function broadcastFiles() {
  const msg = JSON.stringify({ type: "files", files: Array.from(files.keys()) });
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

function broadcastToFile(file, msg, except = null) {
  const raw = JSON.stringify(msg);
  files.get(file)?.clients.forEach(c => {
    if (c !== except && c.readyState === 1) c.send(raw);
  });
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    const msg = JSON.parse(raw);

    if (msg.type === "join") {
      users.set(ws, { name: msg.name, file: null });
      ws.send(JSON.stringify({ type: "files", files: Array.from(files.keys()) }));
      broadcastUserList();
      return;
    }

    if (msg.type === "create-file") {
      if (!files.has(msg.name)) {
        files.set(msg.name, { doc: "", clients: new Set() });
        broadcastFiles();
      }
      return;
    }

    if (msg.type === "open-file") {
      const user = users.get(ws);
      if (!files.has(msg.name)) return;

      if (user.file) {
        files.get(user.file)?.clients.delete(ws);
        broadcastActiveEditors(user.file);
      }

      user.file = msg.name;
      files.get(msg.name).clients.add(ws);

      ws.send(JSON.stringify({ type: "init", file: msg.name, doc: files.get(msg.name).doc }));
      broadcastUserList();
      broadcastActiveEditors(msg.name);
      return;
    }

    if (msg.type === "op") {
      const user = users.get(ws);
      const file = files.get(user.file);
      if (!file) return;

      if (msg.op === "insert" && msg.pos <= file.doc.length)
        file.doc = file.doc.slice(0, msg.pos) + msg.char + file.doc.slice(msg.pos);
      else if (msg.op === "delete" && msg.pos < file.doc.length)
        file.doc = file.doc.slice(0, msg.pos) + file.doc.slice(msg.pos + 1);

      broadcastToFile(user.file, msg, ws);
    }
  });

  ws.on("close", () => {
    const user = users.get(ws);
    if (user?.file) {
      files.get(user.file)?.clients.delete(ws);
      broadcastActiveEditors(user.file);
    }
    users.delete(ws);
    broadcastUserList();
  });
});

// Use Replit port or default 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
