import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const SESSION_DIR = path.resolve("analysis/user_study/sessions");

function saveSessionPlugin() {
  return {
    name: "save-session",
    configureServer(server) {
      server.middlewares.use("/api/save-session", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const session = JSON.parse(body);
            fs.mkdirSync(SESSION_DIR, { recursive: true });
            const reviewer = (session.reviewer_id || "anon").replace(/[^a-zA-Z0-9_-]/g, "");
            const scenario = session.scenario_id || "freeform";
            const ts = (session.created_at || new Date().toISOString()).replace(/[:.]/g, "").slice(0, 15);
            const filename = `${reviewer}_${scenario}_${ts}.json`;
            fs.writeFileSync(path.join(SESSION_DIR, filename), JSON.stringify(session, null, 2));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, filename }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), saveSessionPlugin()],
});
