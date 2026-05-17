import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  const apiKey = process.env.GEMINI_API_KEY;

  // Repo Info Route
  app.get('/api/github/info', async (req, res) => {
    try {
      const repo = req.query.repo as string;
      if (!repo) return res.status(400).json({ error: 'repo required' });
      
      const token = req.headers['authorization'];
      const headers: any = {};
      if (token && token.startsWith('Bearer ')) {
         headers['Authorization'] = token;
      }

      const githubRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!githubRes.ok) {
        return res.status(githubRes.status).json({ error: 'Repo not found or private' });
      }
      const data = await githubRes.json();
      
      const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/${data.default_branch}?recursive=1`, { headers });
      const treeData = await treeRes.json();
      const fileCount = treeData.tree ? treeData.tree.length : 0;

      res.json({
         name: data.full_name,
         branch: data.default_branch,
         fileCount: fileCount,
         tree: treeData.tree ? treeData.tree.filter((t: any) => t.type === 'blob').map((t: any) => t.path).slice(0, 1500) : []
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // OAuth Routes for GitHub
  const OAUTH_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
  const OAUTH_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

  app.get('/api/auth/url', (req, res) => {
    const redirectUri = req.query.redirectUri || `${req.headers.origin}/auth/callback`;
    const params = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID || '',
      redirect_uri: redirectUri as string,
      scope: 'repo user',
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params}` });
  });

  // Code Completion Route
  app.post('/api/complete', async (req, res) => {
    try {
      const { text, context } = req.body;
      if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not defined' });
      
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a code completion engine. Given the current text in a chat input field and some context about connected repos, suggest a short completion (max 10 words) or a small code snippet that would likely follow.
      Context: ${context}
      Current User Input: "${text}"
      
      Return ONLY the suggested completion text, or an empty string if nothing useful can be suggested. Do not explain anything.`;

      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ parts: [{ text: prompt }] }]
      });
      res.json({ suggestion: result.text || '' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: OAUTH_CLIENT_ID,
          client_secret: OAUTH_CLIENT_SECRET,
          code
        })
      });
      const data = await tokenRes.json();
      const accessToken = data.access_token || ''; // handle error if no token
      
      res.send(`
        <!DOCTYPE html>
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', token: '${accessToken}' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (e: any) {
       res.send(`<html><body>Error: ${e.message}</body></html>`);
    }
  });

  // Vite middleware for development
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
