# Mock Server Improvements — Find & Replace Guide

Apply all 5 patches to `backend/mock-server.js` using your text editor's **Find & Replace** (`Ctrl+H` on Windows, `Cmd+H` on Mac, or use VS Code).

**Already done (no action needed):**
- ✅ `express` + `cors` in `devDependencies` (`package.json`)
- ✅ `npm run mock` + `npm run mock:watch` scripts (`package.json`)

---

## How to apply each patch

For each patch below:
1. Open `backend/mock-server.js` in VS Code (or any editor)
2. Press `Ctrl+H` (Windows) or `Cmd+Option+F` (Mac) to open Find & Replace
3. Copy the **FIND** block exactly into the search box
4. Copy the **REPLACE** block exactly into the replace box
5. Click **Replace** (not Replace All — there is only one match per patch)
6. Save the file

---

## Patch 1 — Request logger

**FIND** (this exact line):
```
app.use(express.json());
```

**REPLACE WITH:**
```
app.use(express.json());

// ── DEV: Request logger ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[MOCK] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});
```

---

## Patch 2 — Auth middleware for protected routes

**FIND:**
```
const issuedRefreshTokens = new Map(); // token -> userId
```

**REPLACE WITH:**
```
const issuedRefreshTokens = new Map(); // token -> userId
const issuedAccessTokens = new Map();  // token -> userId (populated on login)

// ── DEV: Auth middleware — require a valid Bearer token on protected routes ──
function requireMockAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token || !issuedAccessTokens.has(token)) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid token. Please login first.',
      timestamp: new Date().toISOString(),
    });
  }
  req.mockUserId = issuedAccessTokens.get(token);
  next();
}
app.use('/api/v1/users', requireMockAuth);
app.use('/api/v1/nursing', requireMockAuth);
app.use('/api/v1/rbac', requireMockAuth);
app.use('/api/v1/audit', requireMockAuth);
app.use('/api/v1/cache', requireMockAuth);
```

Then find the login success block and add one line.

**FIND:**
```
  issuedRefreshTokens.set(mockRefreshToken, user.id);
```

**REPLACE WITH:**
```
  issuedRefreshTokens.set(mockRefreshToken, user.id);
  issuedAccessTokens.set(mockToken, user.id);
```

Then update the logout handler.

**FIND:**
```
  if (userId !== null) {
    for (const [token, uid] of issuedRefreshTokens) {
      if (uid === userId) issuedRefreshTokens.delete(token);
    }
  }
```

**REPLACE WITH:**
```
  if (userId !== null) {
    for (const [token, uid] of issuedRefreshTokens) {
      if (uid === userId) issuedRefreshTokens.delete(token);
    }
    for (const [token, uid] of issuedAccessTokens) {
      if (uid === userId) issuedAccessTokens.delete(token);
    }
  }
```

---

## Patch 3 — Per-user lockout only (remove global lockout)

**FIND** (the entire line):
```
let globalAttempts = { count: 0, lockedUntil: null, lastAttemptAt: null }; // GLOBAL counter - same for username+password errors
```

**REPLACE WITH** (keep `globalAttempts` so existing references don't break, but make it inert):
```
// Global lockout removed — per-user only (dev-friendly: one typo won't lock everyone out)
// globalAttempts kept as a no-op stub so existing references compile without errors
let globalAttempts = { count: 0, lockedUntil: null, lastAttemptAt: null };
```

Then replace `isLocked`:

**FIND:**
```
function isLocked(username) {
  // Check global lock first - if global locked, all users locked
  if (globalAttempts.lockedUntil && Date.now() < globalAttempts.lockedUntil) {
    return true;
  }
  if (globalAttempts.lockedUntil && Date.now() >= globalAttempts.lockedUntil) {
    globalAttempts.count = 0;
    globalAttempts.lockedUntil = null;
  }
  // Also check per-user lock
  const record = loginAttempts[username];
  if (!record || !record.lockedUntil) return false;
  if (Date.now() < record.lockedUntil) return true;
  // Lock expired, reset
  record.count = 0;
  record.lockedUntil = null;
  return false;
}
```

**REPLACE WITH:**
```
function isLocked(username) {
  // Per-user lock only — no global lockout in dev mode
  const record = loginAttempts[username];
  if (!record || !record.lockedUntil) return false;
  if (Date.now() < record.lockedUntil) return true;
  // Lock expired — reset
  record.count = 0;
  record.lockedUntil = null;
  return false;
}
```

Then replace `getRemainingLockTime`:

**FIND:**
```
function getRemainingLockTime(username) {
  // Global lock takes precedence
  if (globalAttempts.lockedUntil) {
    const remaining = globalAttempts.lockedUntil - Date.now();
    if (remaining > 0) return remaining;
  }
  const record = loginAttempts[username];
  if (!record || !record.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil - Date.now());
}
```

**REPLACE WITH:**
```
function getRemainingLockTime(username) {
  // Per-user lock only
  const record = loginAttempts[username];
  if (!record || !record.lockedUntil) return 0;
  return Math.max(0, record.lockedUntil - Date.now());
}
```

---

## Patch 4 — Strip `validUsernames` list from error responses

**FIND** (inside the USER_NOT_FOUND response):
```
        enteredUsername: trimmedUsername,
        validUsernames: Object.keys(mockUsers),
        failedAttempts: globalAttempts.count,
        perUserAttempts: record.count,
        remainingAttempts: 0,
```

**REPLACE WITH:**
```
        enteredUsername: trimmedUsername,
        failedAttempts: record.count,
        remainingAttempts: 0,
```

Then find the second USER_NOT_FOUND response (the non-locked one):

**FIND:**
```
        enteredUsername: trimmedUsername,
        validUsernames: Object.keys(mockUsers),
        failedAttempts: globalAttempts.count, // GLOBAL as requested
        perUserAttempts: record.count,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - globalAttempts.count),
```

**REPLACE WITH:**
```
        enteredUsername: trimmedUsername,
        failedAttempts: record.count,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - record.count),
```

---

## Patch 5 — Dev utility endpoints

**FIND** (near the bottom of the file):
```
// Catch all
app.use((req, res) => {
```

**REPLACE WITH:**
```
// ── DEV: Mock introspection endpoints ────────────────────────────────────────

// List all registered routes
app.get('/api/v1/mock/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((layer) => {
    if (layer.route) {
      const method = Object.keys(layer.route.methods)[0].toUpperCase();
      routes.push({ method, path: layer.route.path });
    }
  });
  res.json({ success: true, data: { count: routes.length, routes }, timestamp: new Date().toISOString() });
});

// Current in-memory state snapshot
app.get('/api/v1/mock/state', (req, res) => {
  res.json({
    success: true,
    data: {
      users: Object.keys(mockUsers).length,
      activeSessions: issuedRefreshTokens.size,
      nurses: typeof mockNurses !== 'undefined' ? mockNurses.filter((n) => !n._deleted).length : 'n/a',
      credentials: typeof mockCredentials !== 'undefined' ? mockCredentials.length : 'n/a',
      rosterAssignments: typeof mockRoster !== 'undefined' ? mockRoster.filter((r) => r.status !== 'Cancelled').length : 'n/a',
      loginAttempts: Object.entries(loginAttempts).reduce((acc, [user, rec]) => {
        if (rec.count > 0) acc[user] = { count: rec.count, locked: !!rec.lockedUntil };
        return acc;
      }, {}),
    },
    timestamp: new Date().toISOString(),
  });
});

// Reset all login counters
app.post('/api/v1/mock/reset', (req, res) => {
  Object.keys(loginAttempts).forEach((k) => { loginAttempts[k] = { count: 0, lockedUntil: null }; });
  globalAttempts.count = 0;
  globalAttempts.lockedUntil = null;
  res.json({ success: true, message: 'All login counters reset', timestamp: new Date().toISOString() });
});

// Catch all
app.use((req, res) => {
```

---

## Test after saving

Restart the mock server (`npm run mock`) then verify:

| URL | Expected result |
|---|---|
| `GET http://localhost:4000/api/v1/mock/routes` | JSON list of all routes |
| `GET http://localhost:4000/api/v1/mock/state` | Data counts snapshot |
| `POST http://localhost:4000/api/v1/mock/reset` | `{ success: true, message: "All login counters reset" }` |
| Login with wrong username 5 times | Only that username is locked, others still work |

---

## Status summary

| Patch | What it does | Status |
|---|---|---|
| `package.json` deps | `express` + `cors` available after `npm install` | ✅ Done |
| `package.json` scripts | `npm run mock` starts the server | ✅ Done |
| Patch 1 | Logs every request with method, path, status, ms | Apply |
| Patch 2 | Blocks 46 unguarded routes unless logged in | Apply |
| Patch 3 | One user's typos can't lock out everyone | Apply |
| Patch 4 | Error messages no longer leak the full user list | Apply |
| Patch 5 | `/mock/routes`, `/mock/state`, `/mock/reset` endpoints | Apply |
