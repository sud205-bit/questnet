import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // dotfiles: 'allow' is required so /.well-known/agent.json and similar
  // agent-discovery files are served correctly by Express
  app.use(express.static(distPath, { dotfiles: 'allow' }));

  // Explicit routes for agentic discovery endpoints with correct Content-Type
  app.get('/.well-known/agent.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.resolve(distPath, '.well-known', 'agent.json'));
  });

  app.get('/llms.txt', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(path.resolve(distPath, 'llms.txt'));
  });

  app.get('/.well-known/ai-plugin.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(path.resolve(distPath, '.well-known', 'ai-plugin.json'));
  });

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
