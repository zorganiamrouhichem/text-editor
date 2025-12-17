const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Map des utilisateurs connectés
// clé : WebSocket, valeur : { name, file }
const users = new Map();

// Map des fichiers collaboratifs
// clé : nom du fichier
// valeur : { doc: contenu du fichier, clients: Set des WebSockets }
const files = new Map();

// ===================== SERVIR LE CLIENT =====================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "client.html"));
});

// ===================== FONCTIONS DE DIFFUSION =====================

// Diffuse la liste des utilisateurs connectés
function broadcastUserList() {
  const userList = Array.from(users.values()).map(user => ({
    name: user.name,
    editingFile: user.file
  }));

  const msg = JSON.stringify({ type: "user-list", users: userList });

  // Envoi à tous les clients connectés
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

// Diffuse la liste des éditeurs actifs d’un fichier
function broadcastActiveEditors(file) {
  if (!file) return;

  const fileData = files.get(file);
  if (!fileData) return;

  // Récupération des noms des utilisateurs éditant ce fichier
  const editors = Array.from(fileData.clients)
    .map(ws => users.get(ws)?.name)
    .filter(name => name);

  const msg = JSON.stringify({ type: "active-editors", editors });

  // Envoi uniquement aux clients du fichier
  fileData.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

// Diffuse la liste des fichiers collaboratifs existants
function broadcastFiles() {
  const msg = JSON.stringify({
    type: "files",
    files: Array.from(files.keys())
  });

  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
}

// Diffuse un message à tous les clients d’un fichier
// except : client émetteur (pour éviter duplication)
function broadcastToFile(file, msg, except = null) {
  const raw = JSON.stringify(msg);

  files.get(file)?.clients.forEach(c => {
    if (c !== except && c.readyState === 1) {
      c.send(raw);
    }
  });
}

// ===================== GESTION DES CONNEXIONS =====================
wss.on("connection", ws => {

  ws.on("message", raw => {
    const msg = JSON.parse(raw);

    // ---------- CONNEXION UTILISATEUR ----------
    if (msg.type === "join") {
      users.set(ws, { name: msg.name, file: null });

      // Envoi de la liste des fichiers existants
      ws.send(JSON.stringify({
        type: "files",
        files: Array.from(files.keys())
      }));

      broadcastUserList();
      return;
    }

    // ---------- CRÉATION D’UN FICHIER ----------
    if (msg.type === "create-file") {
      if (!files.has(msg.name)) {
        files.set(msg.name, {
          doc: "",
          clients: new Set()
        });
        broadcastFiles();
      }
      return;
    }

    // ---------- OUVERTURE D’UN FICHIER ----------
    if (msg.type === "open-file") {
      const user = users.get(ws);
      if (!files.has(msg.name)) return;

      // Retirer l’utilisateur de l’ancien fichier
      if (user.file) {
        files.get(user.file)?.clients.delete(ws);
        broadcastActiveEditors(user.file);
      }

      // Associer l’utilisateur au nouveau fichier
      user.file = msg.name;
      files.get(msg.name).clients.add(ws);

      // Envoi du contenu initial du fichier
      ws.send(JSON.stringify({
        type: "init",
        file: msg.name,
        doc: files.get(msg.name).doc
      }));

      broadcastUserList();
      broadcastActiveEditors(msg.name);
      return;
    }

    // ---------- OPÉRATIONS D'ÉDITION ----------
    if (msg.type === "op") {
      const user = users.get(ws);
      const file = files.get(user.file);
      if (!file) return;

      // Insertion
      if (msg.op === "insert" && msg.pos <= file.doc.length) {
        file.doc =
          file.doc.slice(0, msg.pos) +
          msg.char +
          file.doc.slice(msg.pos);
      }
      // Suppression
      else if (msg.op === "delete" && msg.pos < file.doc.length) {
        file.doc =
          file.doc.slice(0, msg.pos) +
          file.doc.slice(msg.pos + 1);
      }

      // Diffuser l'opération aux autres éditeurs du fichier
      broadcastToFile(user.file, msg, ws);
    }
  });

  // ---------- DÉCONNEXION ----------
  ws.on("close", () => {
    const user = users.get(ws);

    // Retirer l’utilisateur du fichier qu’il éditait
    if (user?.file) {
      files.get(user.file)?.clients.delete(ws);
      broadcastActiveEditors(user.file);
    }

    users.delete(ws);
    broadcastUserList();
  });
});

// ===================== DÉMARRAGE DU SERVEUR =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);