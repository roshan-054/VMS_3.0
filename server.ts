import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
  });

  // Serve backend Apps Script Code.gs
  app.get('/api/backend-code', (req, res) => {
    try {
      const codePath = path.join(process.cwd(), 'backend', 'Code.gs');
      if (fs.existsSync(codePath)) {
        const code = fs.readFileSync(codePath, 'utf-8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send(code);
      }
      res.status(404).send('// backend/Code.gs not found');
    } catch (err: any) {
      res.status(500).send(`// Error reading backend/Code.gs: ${err.message}`);
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VMS Station Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
