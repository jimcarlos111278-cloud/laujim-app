// session-memory OpenCode plugin
// Persists a plain-text summary of recent user/assistant interactions across
// sessions and injects it into the system prompt of every new chat so the
// agent "remembers" what was discussed in previous sessions.
//
// How it works:
//   1. Reads the OpenCode SQLite database (~/.local/share/opencode/opencode.db)
//      which already stores every message and its text parts.
//   2. Filters to the current project's sessions and pulls the last N
//      user questions + assistant answers (plain text only).
//   3. Writes a rolling summary to <project>/.opencode/session-memory.md
//      (kept to the last N interactions).
//   4. Injects that summary into the system prompt via
//      experimental.chat.system.transform so a fresh chat has context.
//
// IMPORTANT: keep strings free of backticks and $(...) constructs where they
// could be interpolated. This plugin only reads the DB and writes a file; it
// never executes the summary as a command.

import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const MAX_INTERACTIONS = 50; // last N user questions + assistant answers

// Resolve the OpenCode SQLite database path across platforms.
function dbPath() {
  const candidates = [
    join(homedir(), ".local", "share", "opencode", "opencode.db"),
    join(homedir(), ".config", "opencode", "opencode.db"),
    join(process.env.APPDATA || "", "opencode", "opencode.db"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

// Load node:sqlite if available (Node 22+). Returns null otherwise.
function loadSqlite() {
  try {
    // eslint-disable-next-line global-require
    const { DatabaseSync } = require("node:sqlite");
    return DatabaseSync;
  } catch (e) {
    return null;
  }
}

// Read the last N user questions + assistant answers for the current project.
function readRecentInteractions(dbFile, projectDir, limit) {
  const DatabaseSync = loadSqlite();
  if (!DatabaseSync) return [];
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db
      .prepare(
        `SELECT m.id, json_extract(m.data,'$.role') AS role, m.time_created,
                (SELECT group_concat(json_extract(p.data,'$.text'),' ')
                 FROM part p
                 WHERE p.message_id = m.id
                   AND json_extract(p.data,'$.type')='text') AS text
         FROM message m
         JOIN session s ON m.session_id = s.id
         WHERE s.directory = ?
           AND json_extract(m.data,'$.role') IN ('user','assistant')
           AND text IS NOT NULL AND text != ''
         ORDER BY m.time_created DESC
         LIMIT ?`
      )
      .all(projectDir, limit * 2);
    db.close();
    // rows come newest-first; reverse to chronological order
    return rows.reverse();
  } catch (e) {
    return [];
  }
}

// Build a plain-text summary from the interaction rows.
function buildSummary(rows) {
  if (!rows || rows.length === 0) {
    return "No hay interacciones previas registradas para este proyecto.";
  }
  const lines = [];
  lines.push("# Resumen de interacciones recientes");
  lines.push("");
  lines.push(
    `Este es un resumen de los últimos ${rows.length} mensajes (preguntas y respuestas) entre el usuario y el agente en sesiones anteriores de este proyecto.`
  );
  lines.push("");
  for (const r of rows) {
    const role = r.role === "user" ? "USUARIO" : "AGENTE";
    const text = String(r.text || "").trim();
    if (!text) continue;
    // Truncate very long assistant answers to keep the summary compact.
    const maxLen = role === "AGENTE" ? 600 : 400;
    const shown = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
    lines.push(`### ${role}`);
    lines.push(shown);
    lines.push("");
  }
  return lines.join("\n");
}

export const SessionMemoryPlugin = async ({ directory }) => {
  let injected = false;

  return {
    // Inject the summary into the system prompt on the first turn of a chat.
    "experimental.chat.system.transform": async (_input, output) => {
      if (injected) return;
      const dbFile = dbPath();
      if (!dbFile) return;
      const rows = readRecentInteractions(dbFile, directory, MAX_INTERACTIONS);
      if (rows.length === 0) return;
      const summary = buildSummary(rows);

      // Persist the summary to a file for manual review / debugging.
      try {
        const outDir = join(directory, ".opencode");
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "session-memory.md"), summary, "utf8");
      } catch (e) {
        // non-fatal
      }

      const block =
        "\n\n## Contexto de sesiones anteriores (memoria persistente)\n\n" +
        summary +
        "\n\nUsa este contexto para recordar qué se ha discutido y decidido en sesiones anteriores. No lo repitas al usuario; úsalo como referencia interna.";

      if (output.system && output.system.length > 0) {
        output.system[output.system.length - 1] += block;
      } else {
        output.system = [block];
      }
      injected = true;
    },
  };
};
