# Nurse-App v01 - System Check & Analysis Report
**Date:** 2026-09-11 (Asia/Riyadh)
**Branch:** arena/01a08f14-nurse-app-v01
**Analyst:** Arena Agent Mode
**Scope:** Authentication & Login Error Handling UX

---

## 1. SYSTEM CHECK - Current State

### 1.1 Architecture Overview
```
Frontend (React + Vite :3000)
  → Vite Proxy /api → Mock Backend Express :4000 (MOCK FIXED)
  → Real Backend NestJS :4001 (MOCK mode, no DB)
  → Production: Postgres + Redis + NestJS via docker-compose
```

**Services Status (Arena Preview):**
- ✅ Frontend 3000: Vite 5.4.21, allowedHosts:true, X-Frame-Options ALLOWALL, HMR working
- ✅ Mock Backend 4000: Express, 10 users, validates Password123!, returns distinct roles, errorCodes USER_NOT_FOUND/INVALID_PASSWORD
- ✅ Real Backend 4001: NestJS, PrismaService mock with bcrypt hash $2a$12$PYO..., 10 users, detailed messages

### 1.2 Authentication Flow
1. User types username/password → onValuesChange persists to localStorage `lastLoginAttempt`
2. onFinish → setLoading, persist, call authApi.login()
3. apiClient interceptor: skips 401 redirect for /auth/login (fixed earlier bug that caused full reload)
4. Backend validates:
   - Mock: checks username exists, password === Password123!
   - Real: bcrypt.compare, lockout after 5 attempts, status check
5. On success: tokens stored, user stored, navigate /dashboard
6. On failure: error parsed, setError, form.setFieldsValue preserves input, toast message.error

**Fixed Issues in Session:**
- [FIXED] Mock accepted any password → now 401 validation
- [FIXED] Always returned SYSTEM_ADMIN → now 10 distinct users per username
- [FIXED] 403 Arena preview host blocked → allowedHosts:true
- [FIXED] No error message shown → interceptor was redirecting to /login wiping state
- [FIXED] Form disappeared on login click → AuthContext was setting global isLoading causing PublicRoute spinner
- [FIXED] Refresh reset to admin default → now localStorage persistence

### 1.3 Current Login UI Structure
```
Card (440px width)
  ├─ Header: Icon, Title, RBAC text, Last typed badge (blue)
  ├─ Alert (if error): 
  │   ├─ message="Login Failed - Your input preserved"
  │   ├─ description: userFriendlyMessage + preserved input box (red bg)
  │   └─ showIcon, closable
  ├─ Form (preserve=true, initialValues from localStorage)
  │   ├─ username Input
  │   ├─ password Input.Password
  │   ├─ Button Log in (loading)
  │   └─ Reset to default link
  ├─ Divider Demo Accounts (click to fill)
  └─ Footer
```

Plus toast: `message.error(userFriendlyMessage, 6)` duplicate.

---

## 2. SYSTEM ISSUE REPORT

### 2.1 Critical Issues - RESOLVED
| ID | Issue | Severity | Status |
|---|---|---|---|
| AUTH-001 | Mock accepted any password | Critical | Fixed |
| AUTH-002 | Always returned admin.system regardless of username | Critical | Fixed |
| AUTH-003 | No error feedback on wrong credentials (interceptor redirect) | High | Fixed |
| AUTH-004 | Form flicker/disappear on login click (global isLoading) | High | Fixed |
| AUTH-005 | Refresh reset to default, lost last action | Medium | Fixed with localStorage |

### 2.2 Current Minor Issues - Error Message Position

**Issue ID:** UX-001 - Error Message Location & Presentation
**Severity:** Low-Medium (UX)
**Current Behavior:**
- Alert positioned **between header and form**, above both fields
- Causes layout shift: Card height jumps 120-180px when error appears, pushing form down
- Not associated with specific field (username vs password)
- Duplicate feedback: Alert + toast message.error (same content, 6 sec)
- Preserved input box inside Alert adds extra height, makes Alert very tall (200px+)
- On mobile, pushes form below fold
- After error, user must scroll up to see error, then down to edit field
- No inline field validation highlight (red border) for which field is wrong

**Evidence:**
- Current Alert has `marginBottom: 20`, plus inner preserved box with border, background #fff2f0
- Error message includes username in text, but field itself not marked invalid
- Last typed badge in header also shows username, redundant with Alert preserved box

**Impact:**
- User confusion: "Is username wrong or password wrong?" - message says but field not highlighted
- Accessibility: Screen readers read Alert far from input
- Visual hierarchy: Error competes with title, not near action
- Duplicate toasts annoy power users

### 2.3 Other Observations

**Backend:**
- Real backend still returns 400 validation "password must be longer than..." for short passwords (<8 chars) before reaching auth logic. Frontend handles but message generic.
- Mock and Real error shapes differ: Mock returns {success, errorCode, message, details}, Real returns {message, error, statusCode}. Frontend parses both but could be unified.
- No rate limiting visible on mock, real has lockout after 5 attempts but no CAPTCHA.

**Frontend:**
- `localStorage lastLoginAttempt` stores password in plain text - okay for demo but security concern for production (should store only username, or encrypted)
- `initialValues` from localStorage means password persists across sessions - good for UX per user request but bad for shared computers
- No password visibility toggle hint for demo? Has eye icon.
- Demo accounts clickable is good, but 6 accounts only, missing 4 (ahmed.hassan, jennifer.smith, david.kim, michael.wong)
- No "Forgot password" link (expected for hospital system)

**Security:**
- bcrypt hash $2a$12$... is valid for Password123! - verified
- Tokens: mock_jwt_{id}_{role}_{ts} is not real JWT, but real backend uses real JWT - okay for preview
- No CSRF protection visible, but uses Bearer token

---

## 3. SYSTEM RECOMMENDATION

### 3.1 Immediate Recommendation - Error Message Position (User Requested)

**Goal:** Error should be near field that caused it, not cause layout shift, and preserve last action.

**Option A - Inline Field Errors (RECOMMENDED for Hospital System):**
```
- Remove top Alert (or keep only for generic 500 errors)
- Use Form setFields to mark specific field invalid:
  - USER_NOT_FOUND → set username field error: "Username not found" + red border, keep password
  - INVALID_PASSWORD → set password field error: "Incorrect password" + red border, keep username
  - Both preserved, user edits only wrong field
- Keep small top Alert only for account locked / inactive (not field-specific)
- Remove duplicate toast, keep only inline
- Position: error text directly under input, 4px margin, no layout shift beyond 20px
```

**Implementation Sketch:**
```tsx
// In catch:
if (errorCode === 'USER_NOT_FOUND') {
  form.setFields([{ name: 'username', errors: [userFriendlyMessage] }]);
} else if (errorCode === 'INVALID_PASSWORD') {
  form.setFields([{ name: 'password', errors: [userFriendlyMessage] }]);
} else {
  setError(userFriendlyMessage); // generic top Alert for locked etc
}
```

**Pros:** 
- Meets WCAG: error associated with input via aria
- No big layout shift
- Clear which field to fix
- Preserves last action (other field stays)

**Option B - Sticky Top Banner (Current Improved):**
```
- Keep Alert but make it sticky top of Card with max-height 80px, overflow scroll
- Move preserved input box out of Alert into separate small info box below form
- Position Alert above form but with position: sticky, so visible without pushing form too much
- Reduce Alert height: only message, no preserved box inside
```

**Option C - Toast Only + Field Highlight:**
```
- No Alert at all
- Use message.error toast + field red border
- Toast auto-dismiss 5 sec, not blocking
- Best for minimal UI, but toast may be missed
```

**My Recommendation:** **Option A** for this hospital RBAC system because:
- Clinical users need clear, immediate feedback on which credential is wrong
- Preserves last action per user request (keep other field)
- No refresh reset (already fixed with localStorage)
- Follows Ant Design best practice

### 3.2 Short-term Improvements (Next Sprint)

1. **Unify Backend Error Shape:**
   ```json
   { success:false, errorCode:"USER_NOT_FOUND", message:"...", details:{hint, validUsernames} }
   ```
   Both mock and real should return same shape. Frontend can then switch on errorCode.

2. **Security - Don't Store Password in localStorage:**
   - Store only username in localStorage, not password
   - Or store encrypted, or sessionStorage only
   - Add comment: "Demo only, production should not store password"

3. **Add All Demo Accounts:**
   - Show 10 accounts, not 6, in 2 columns with role badges

4. **Rate Limit UI:**
   - After 3 failed attempts, show "Attempt 3/5" and countdown
   - After lockout, show timer

5. **Loading State:**
   - Button loading is good, but also disable inputs during loading to prevent double submit

### 3.3 Long-term / Production Recommendations

1. **Forgot Password & Self-Service:**
   - Add "Forgot password?" link → email reset flow
   - Required for hospital workforce (nurses forget passwords)

2. **Audit Logging Visible:**
   - Show last login time, failed attempts in UI

3. **Accessibility:**
   - Add aria-live="assertive" to error region
   - Ensure color contrast for error (current #ff4d4f okay)

4. **Testing:**
   - Add e2e test: wrong username preserves input, wrong password preserves username, refresh preserves
   - Add unit test for errorCode parsing

5. **Production Backend:**
   - Enable docker-compose with real Postgres + Redis
   - Implement CAPTCHA after 3 failures
   - Implement password complexity meter

---

## 4. DECISION LOG

- User confirmed: "ok it works what i want" for preserved input fix
- User noted: "a little miss appropriate position or location of error message" → This report addresses it, recommendation is Option A inline field errors
- User requested: system check and analysis, issue report, recommendation → Provided in this doc

---

## 5. NEXT STEPS (If Approved)

1. Implement Option A inline errors (30 min)
2. Remove duplicate toast or keep only for generic errors
3. Update localStorage to store only username (security)
4. Commit and push
5. Retest with user: type wrong username → username field red + message under it, password preserved; type wrong password → password field red, username preserved

---

**Prepared by:** Arena Agent
**Files Modified in Session:**
- backend/mock-server.js (errorCodes, detailed messages)
- backend/src/modules/auth/auth.service.ts (specific messages)
- backend/src/modules/auth/prisma.service.ts (10 users, valid bcrypt hash)
- frontend/src/api/client.ts (skip redirect for login)
- frontend/src/context/AuthContext.tsx (no global isLoading on login)
- frontend/src/pages/Login.tsx (preserve input, localStorage, error handling)

**Preview URLs:**
- Frontend: https://3000-{sandbox}.e2b.app
- Mock Backend: https://4000-{sandbox}.e2b.app/api/v1/health
- Real Backend: https://4001-{sandbox}.e2b.app/api/v1/health
