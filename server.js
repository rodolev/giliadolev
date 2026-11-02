/**
 * Gilia Dolev | Zero-Dependency Node.js Server & Admin Backend
 * Run with: node server.js (Default port: 3000)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Password hashing helpers using scrypt + timingSafeEqual
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
};

const verifyPassword = (password, salt, expectedHash) => {
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (hashBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, expectedBuffer);
};

// Initialize admin credentials if not present
if (!fs.existsSync(AUTH_FILE)) {
  const initialPassword =
    process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Generated initial admin password: ${initialPassword}`);
  }
  const { salt, hash } = hashPassword(initialPassword);
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ username: 'gilia', salt, hash }, null, 2),
    'utf8'
  );
}

if (!fs.existsSync(LEADS_FILE)) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify({ leads: [] }, null, 2), 'utf8');
}

// Active in-memory sessions (token -> expiry timestamp)
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const parseCookies = (cookieHeader = '') => {
  const out = {};
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
};

const getSessionToken = (req) => {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies['__Host-session'] || cookies['gilia_session'] || '';
};

const isAuthenticated = (req) => {
  const token = getSessionToken(req);
  if (!token || !sessions.has(token)) return false;
  const expiresAt = sessions.get(token);
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
};

const readJsonBody = (req, maxBytes = 8 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const sendJson = (res, statusCode, data, extraHeaders = {}) => {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const applySecurityHeaders = (res) => {
  res.setHeader('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'none'; object-src 'none'; base-uri 'none'"
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), focus-without-user-activation=()'
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
};

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  // Support local dev origins (e.g. Live Server on 127.0.0.1 / localhost)
  const origin = req.headers.origin;
  if (
    origin &&
    (origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin === 'null')
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Fetch Metadata Resource Isolation check (security §3.7)
  const site = req.headers['sec-fetch-site'];
  const mode = req.headers['sec-fetch-mode'];
  const dest = req.headers['sec-fetch-dest'];
  const isLocalOrigin =
    origin &&
    (origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin === 'null');

  if (site && !isLocalOrigin && !['same-origin', 'same-site', 'none'].includes(site)) {
    const isSafeNav =
      site === 'cross-site' &&
      mode === 'navigate' &&
      req.method === 'GET' &&
      !['object', 'embed'].includes(dest);
    if (!isSafeNav) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // --- API Routes ---

  // 1. Check Session Status
  if (pathname === '/api/session' && req.method === 'GET') {
    return sendJson(res, 200, { authenticated: isAuthenticated(req) });
  }

  // 2. Login
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const { username, password } = await readJsonBody(req);
      const authData = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));

      const cleanUser = String(username || '').trim().toLowerCase();
      const allowedUsers = [
        String(authData.username).toLowerCase(),
        'gilia',
        'גיליה',
        'גיליה דולב',
        'admin'
      ];
      const userMatch = !cleanUser || allowedUsers.includes(cleanUser);
      const passMatch = verifyPassword(
        String(password || '').trim(),
        authData.salt,
        authData.hash
      );

      if (!userMatch || !passMatch) {
        return sendJson(res, 401, { error: 'שם משתמש או סיסמה שגויים.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_TTL_MS);

      const isSecure =
        req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      const cookieName = isSecure ? '__Host-session' : 'gilia_session';
      const cookieFlags = [
        `${cookieName}=${token}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${SESSION_TTL_MS / 1000}`
      ];
      if (isSecure) cookieFlags.push('Secure');

      return sendJson(
        res,
        200,
        { ok: true, token },
        { 'Set-Cookie': cookieFlags.join('; ') }
      );
    } catch {
      return sendJson(res, 400, { error: 'בקשה לא תקינה.' });
    }
  }

  // 3. Logout (with Clear-Site-Data per security guide)
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = getSessionToken(req);
    if (token) sessions.delete(token);

    return sendJson(
      res,
      200,
      { ok: true },
      {
        'Clear-Site-Data': '"cookies", "storage", "cache"',
        'Set-Cookie': 'gilia_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
      }
    );
  }

  // 4. Get Site Content (Public GET, Protected PUT)
  if (pathname === '/api/content' && req.method === 'GET') {
    const content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
    return sendJson(res, 200, content);
  }

  if (pathname === '/api/content' && req.method === 'PUT') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'לא מחוברת' });
    }
    try {
      const body = await readJsonBody(req);
      const current = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
      const updated = {
        ...current,
        brandName: String(body.brandName ?? current.brandName),
        brandRole: String(body.brandRole ?? current.brandRole),
        phoneDisplay: String(body.phoneDisplay ?? current.phoneDisplay),
        phoneClean: String(body.phoneClean ?? current.phoneClean),
        heroEyebrow: String(body.heroEyebrow ?? current.heroEyebrow),
        heroTitle: String(body.heroTitle ?? current.heroTitle),
        heroLead: String(body.heroLead ?? current.heroLead),
        heroWhatsappBtn: String(body.heroWhatsappBtn ?? current.heroWhatsappBtn),
        heroContactBtn: String(body.heroContactBtn ?? current.heroContactBtn),
        heroImage: String(body.heroImage ?? current.heroImage),
        aboutHeading: String(body.aboutHeading ?? current.aboutHeading),
        aboutParagraph1: String(body.aboutParagraph1 ?? current.aboutParagraph1),
        aboutParagraph2: String(body.aboutParagraph2 ?? current.aboutParagraph2),
        qualificationsHeading: String(
          body.qualificationsHeading ?? current.qualificationsHeading
        ),
        qualificationsBullets: Array.isArray(body.qualificationsBullets)
          ? body.qualificationsBullets.map((s) => String(s))
          : current.qualificationsBullets,
        visitHeading: String(body.visitHeading ?? current.visitHeading),
        visitBullets: Array.isArray(body.visitBullets)
          ? body.visitBullets.map((s) => String(s))
          : current.visitBullets,
        contactHeading: String(body.contactHeading ?? current.contactHeading),
        contactSubtitle: String(body.contactSubtitle ?? current.contactSubtitle),
        footerCopy: String(body.footerCopy ?? current.footerCopy)
      };

      fs.writeFileSync(CONTENT_FILE, JSON.stringify(updated, null, 2), 'utf8');
      return sendJson(res, 200, { ok: true, content: updated });
    } catch {
      return sendJson(res, 400, { error: 'שגיאה בשמירת התוכן' });
    }
  }

  // 5. Upload New Photo (Protected POST)
  if (pathname === '/api/upload-photo' && req.method === 'POST') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'לא מחוברת' });
    }
    try {
      const { dataUrl } = await readJsonBody(req);
      const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(
        String(dataUrl || '')
      );
      if (!match) {
        return sendJson(res, 400, { error: 'פורמט תמונה לא נתמך' });
      }
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      const fileName = `gilia-custom.${ext}`;
      const filePath = path.join(ASSETS_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      return sendJson(res, 200, { ok: true, path: `assets/${fileName}` });
    } catch {
      return sendJson(res, 400, { error: 'שגיאה בהעלאת התמונה' });
    }
  }

  // 6. Website Contact Form Inquiries (Public POST, Protected GET & DELETE)
  if (pathname === '/api/leads' && req.method === 'POST') {
    try {
      const { name, phone, notes } = await readJsonBody(req);
      const store = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
      const newLead = {
        id: crypto.randomUUID(),
        name: String(name || '').slice(0, 100),
        phone: String(phone || '').slice(0, 30),
        notes: String(notes || '').slice(0, 500),
        createdAt: new Date().toISOString()
      };
      store.leads.unshift(newLead);
      fs.writeFileSync(LEADS_FILE, JSON.stringify(store, null, 2), 'utf8');
      return sendJson(res, 201, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'בקשה לא תקינה' });
    }
  }

  if (pathname === '/api/leads' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'לא מחוברת' });
    }
    const store = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    return sendJson(res, 200, store);
  }

  if (pathname.startsWith('/api/leads/') && req.method === 'DELETE') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'לא מחוברת' });
    }
    const leadId = decodeURIComponent(pathname.replace('/api/leads/', ''));
    const store = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    store.leads = (store.leads || []).filter((l) => l.id !== leadId);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(store, null, 2), 'utf8');
    return sendJson(res, 200, { ok: true });
  }

  // 7. Update Admin Password (Protected PUT)
  if (pathname === '/api/password' && req.method === 'PUT') {
    if (!isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'לא מחוברת' });
    }
    try {
      const { newPassword } = await readJsonBody(req);
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return sendJson(res, 400, { error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
      }
      const authData = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
      const { salt, hash } = hashPassword(newPassword);
      authData.salt = salt;
      authData.hash = hash;
      fs.writeFileSync(AUTH_FILE, JSON.stringify(authData, null, 2), 'utf8');
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: 'שגיאה בעדכון הסיסמה' });
    }
  }

  // --- Static File Serving ---
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  if (relativePath === '/admin') relativePath = '/admin.html';

  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(ROOT_DIR, safePath);

  // Prevent access to server.js or auth.json / leads.json directly via static file handler
  const blockedFiles = [
    path.join(ROOT_DIR, 'server.js'),
    AUTH_FILE,
    LEADS_FILE
  ];
  if (
    !fullPath.startsWith(ROOT_DIR) ||
    blockedFiles.includes(fullPath) ||
    !fs.existsSync(fullPath) ||
    fs.statSync(fullPath).isDirectory()
  ) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(fullPath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin panel available at http://localhost:${PORT}/admin`);
});
