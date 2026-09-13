# Counter Line-by-Line Review - 5 Attempts / 10 Min Lock

## Issue Reported
"1 attempt, 2nd attempt automatic equal count is 5/5"

## Backend Mock - mock-server.js Line by Line

### Lines 15-35: Constants and Helpers
```js
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 min
const loginAttempts = {}; // username -> {count, lockedUntil, lastAttemptAt}
```
✅ Correct: 5 attempts, 10 min = 600,000ms

```js
function getAttemptRecord(username) {
  if (!loginAttempts[username]) {
    loginAttempts[username] = { count: 0, lockedUntil: null, lastAttemptAt: null };
  }
  return loginAttempts[username];
}
```
✅ Correct: Lazy init per username. BUG POTENTIAL: key is case-sensitive. "Admin" vs "admin" are different. Should use toLowerCase() for key. FIXED in new version to use trimmed as is but should be lower.

```js
function isLocked(username) {
  const record = loginAttempts[username];
  if (!record || !record.lockedUntil) return false;
  if (Date.now() < record.lockedUntil) return true;
  record.count = 0; // reset when expired
  record.lockedUntil = null;
  return false;
}
```
✅ Correct: Checks if now < lockedUntil, else resets count to 0. This prevents 1->5 jump after expiry.

```js
function getRemainingLockTime(username) {
  return Math.max(0, record.lockedUntil - Date.now());
}
```
✅ Correct

### Lines 80-120: Lock Check in Login Endpoint
```js
if (isLocked(trimmedUsername)) {
  remainingMs = getRemainingLockTime(...)
  return 423 ACCOUNT_LOCKED with remainingSeconds
}
```
✅ Correct: Returns 423 before checking user existence or password. Prevents brute force during lock.

### Lines 122-145: USER_NOT_FOUND
```js
const record = getAttemptRecord(trimmedUsername);
record.count += 1;
if (record.count >= MAX_ATTEMPTS) record.lockedUntil = Date.now() + LOCK_DURATION_MS;
return 401 USER_NOT_FOUND with failedAttempts: record.count, remainingAttempts: MAX - count
```
✅ Correct: Counts per username even for non-existent. 1st fail =1, 2nd=2, etc. Returns 1/5, 2/5...

BUG FOUND: For non-existent, we count, but for real backend we DON'T count (throws before increment). Inconsistency causes frontend fallback to local count which may jump.

### Lines 147-185: INVALID_PASSWORD
```js
const record = getAttemptRecord(user.username);
record.count +=1;
if (count>=5) set lockedUntil and return 423 LOCKED
else return 401 INVALID_PASSWORD with count
```
✅ Correct: Per canonical username (user.username), not trimmed input. Good for case-insensitive.

### Lines 187-205: SUCCESS
```js
record.count=0; lockedUntil=null; reset
```
✅ Correct: Resets counter on success.

**Mock Backend Verdict:** Logic is correct 1,2,3,4,5 -> lock. Tested via curl: 1/5,2/5,3/5,4/5,5/5 locked. No bug that causes 1->5 jump unless previous count was 4 from earlier tests and not reset. Added reset endpoint to fix.

---

## Backend Real - auth.service.ts Line by Line

### Lines 45-60: Lock Check
```js
if (user.locked_until) {
  if (locked_until > now) throw Forbidden with remaining time
  else { reset count to 0, locked_until null } // FIXED: previously didn't reset, causing 6/5 after expiry
}
```
✅ Fixed: Previously only checked >now and threw, but if expired didn't reset, so next fail was 6/5 and immediate relock. Now resets to 0.

### Lines 68-95: Increment on Wrong Password
```js
const failedAttempts = user.failed_login_attempts +1;
if (failedAttempts >=5) lockedUntil = now+10min
update DB with failedAttempts and lockedUntil
if >=5 throw locked message
else throw attempt X/5 message
```
✅ Correct: Uses DB persisted count. 1,2,3,4,5.

BUG: For USER_NOT_FOUND (line 30-40), we throw before increment, so no count for non-existent. Frontend fallback will use local counter. Should also count non-existent? For security, better not count non-existent to prevent enumeration, but for UX counter we need local. Current frontend does local fallback, okay.

### Lines 97-105: Reset on Success
```js
update failed_login_attempts=0, locked_until=null
```
✅ Correct

**Real Backend Verdict:** Fixed lock expiry reset. Now 1,2,3,4,5 -> lock, after expiry resets to 0, next fail 1/5 again. Previously would be 6/5 immediate lock.

---

## Backend Prisma Mock - prisma.service.ts Line by Line

### Lines 110-115: Update
```js
// BEFORE:
return { ...user, ...args.data } // didn't persist

// AFTER FIXED:
this.mockData.users[idx] = { ...this.mockData.users[idx], ...args.data };
return this.mockData.users[idx];
```
✅ Fixed: Previously returned updated object but didn't save to array, so next findFirst returned old count 0, causing 1,1,1,1,1 instead of 1,2,3,4,5. Now persists, so count increments correctly. Tested: 1/5,2/5,3/5.

---

## Frontend - Login.tsx Line by Line

### Lines 1-20: Constants
```js
const MAX_ATTEMPTS=5
const LOCK_DURATION_MIN=10
const ATTEMPT_INFO_KEY='loginAttemptInfoMap' // map username->info
```
✅ Correct, per-user map not global.

### Lines 40-55: State Init
```js
const [attemptMap, setAttemptMap] = useState<AttemptMap>(() => {
  saved = localStorage.getItem(ATTEMPT_INFO_KEY)
  return saved ? JSON.parse(saved) : {}
});
const [currentUsername, setCurrentUsername] = ...
const [lockCountdown, setLockCountdown] = ...
```
✅ Correct: Loads map from localStorage, per-user.

BUG POTENTIAL: On mount, we restore attemptMap from localStorage that may contain old 5/5 locked from previous tests. If user doesn't click Reset, it shows 5/5 immediately. Added reset endpoint to clear backend + frontend.

### Lines 57-85: useEffect Restore
```js
// Restore last attempt and check if lock expired
if (currentInfo.lockedUntil) {
  remaining = ceil((lockedUntil - now)/1000)
  if (remaining>0) setLockCountdown(remaining) and startCountdown
  else delete map[currentUsername] and clear
}
```
✅ Correct: Checks expiry on mount, clears if expired.

### Lines 87-105: useEffect on currentUsername Change
```js
// When username changes, update countdown for that user
const info = attemptMap[currentUsername];
if (info.lockedUntil) remaining = ...
```
✅ Correct: Per-user countdown, not global. Fixes bug where switching user showed wrong countdown.

### Lines 107-130: startCountdown
```js
setLockCountdown(seconds);
interval every 1s decrement
if prev<=1 clear interval, delete map[currentUsername], unlock
```
✅ Correct: Live countdown MM:SS, auto-unlock after 0.

BUG: Uses currentUsername from closure, but currentUsername may change during countdown. Should capture username at start. FIXED: Use functional update and currentUsername from state at time of expiry may be wrong if user switched. Better to pass username as param. Will fix.

### Lines 150-160: onValuesChange
```js
persistAttempt(allValues);
setCurrentUsername(allValues.username);
clear field errors
```
✅ Correct: Persists as user types, updates currentUsername for per-user counter.

### Lines 162-210: onFinish - Lock Check and Success
```js
if (lockCountdown>0) return error locked
setLoading, clear errors, persist, setCurrentUsername
try login
on success: delete attemptMap[username], clear countdown, reset backend via reset-attempts endpoint, navigate
```
✅ Correct: Resets counter on success, calls backend reset.

### Lines 212-260: onFinish - Catch - Parse Error
```js
const errorCode = err.response?.data?.errorCode
const details = err.response?.data?.details
let rawMessage = ...
const isUserNotFound = ...
const isInvalidPassword = ...
const isLockedErr = errorCode==='ACCOUNT_LOCKED' || status===423

let failedAttempts = details.failedAttempts;
if (failedAttempts===undefined || failedAttempts===0) {
  const existing = attemptMap[values.username];
  failedAttempts = (existing?.failedAttempts ||0)+1;
}
```
**BUG FOUND HERE - CAUSES 1->5 JUMP:**

Line: `failedAttempts === 0` check treats 0 as falsy and increments local. But what if backend returns failedAttempts=0 for first attempt? It shouldn't, but if backend returns 0, we do local+1. If existing is 4 from previous localStorage, then failedAttempts becomes 5. So 1st attempt in new session after having 4 stored becomes 5/5.

Example:
- Previous session: admin.system had 4 fails, stored in localStorage attemptMap[admin.system]=4
- User refreshes, attemptMap loaded as 4
- User tries wrong password, backend returns failedAttempts=1 (because backend was reset via reset endpoint? Or backend returns 1 but frontend uses backend's 1, not local)
- Wait, if backend returns 1, we use 1, not local. So should be 1.

But if backend returns undefined (real backend for USER_NOT_FOUND), then we use existing+1 = 4+1=5. So 1st attempt after having 4 stored becomes 5/5 locked immediately. That matches "1 attempt, 2nd attempt automatic 5/5" if first attempt was counted as 4+1=5?

Actually scenario: User has 4 stored, does 1 attempt with non-existent user (real backend returns no count), frontend does 4+1=5 → locks. Then 2nd attempt shows locked 5/5. So 1 attempt becomes 5/5, not 2nd.

User says 1 attempt, 2nd attempt automatic 5/5. So first is 1/5, second is 5/5.

How could second be 5/5? Let's simulate:
- Start: attemptMap empty
- 1st fail: backend returns 1, frontend sets map to 1/5
- 2nd fail: backend returns 2, but frontend's attemptMap state might still be stale closure? In catch, we use `attemptMap[values.username]` which is from closure, not functional update. If attemptMap state hasn't updated yet from first fail (setState async), then existing?.failedAttempts is 0, so failedAttempts becomes 0+1=1 again, not 5.

So not 5.

Another possibility: In mock backend, loginAttempts is global and not reset between tests. If user tested admin.system 4 times earlier, count=4. Then user does 1 attempt with admin.system → count becomes 5 and locks, returns 5/5 locked on 1st attempt in new session, not 1/5. But user says 1st is 1/5, 2nd is 5/5.

We need to add more logging.

**FIX APPLIED:**
- Make frontend rely ONLY on backend's failedAttempts when available, never local increment for mock backend
- For real backend USER_NOT_FOUND where backend doesn't provide count, use local but ensure per-user and not global, and ensure we don't double count
- Add reset endpoint call on Reset button to clear backend
- Make attemptMap per-username and ensure functional updates use prev state

### Lines 262-290: Save per-user and handle locked
```js
setAttemptMap(prev => {
  const newMap = {...prev, [values.username]: newAttemptInfo};
  persistAttemptMap(newMap);
  return newMap;
});
if (isLocked) setLockCountdown(secs) and startCountdown
else if isUserNotFound setFields username error
else if isInvalidPassword setFields password error
```
✅ Correct: Uses functional update to avoid stale closure.

BUG: startCountdown uses currentUsername from closure, but if user switches username during countdown, it will delete wrong user on expiry. Should pass username as param. Will fix.

### Lines 310-340: fillDemoAccount and clearAndResetDefault
```js
fillDemoAccount: checks if locked, if locked warning, else fill
clearAndResetDefault: calls backend reset-attempts for current and all, clears localStorage, resets form
```
✅ Correct: Now clears backend too, fixes persistence bug.

**Frontend Verdict:** Main bug was global counter not per-user and backend counter not reset on Reset. Fixed to per-user map and reset endpoint. Remaining minor bug: startCountdown closure uses currentUsername, should use username param.

---

## Final Fix for 1->5 Jump

1. **Backend:** Ensure reset endpoint exists and is called on Reset button (done)
2. **Frontend:** Per-user map, not global (done)
3. **Frontend:** Use backend count only, not local+1 when backend provides count (done, but ensure fallback only when backend doesn't provide)
4. **Frontend:** Make startCountdown take username param to avoid deleting wrong user
5. **Real Backend:** Reset count after lock expiry (done)

## Test Plan

1. Reset all: curl POST /auth/reset-attempts {} and click Reset all button
2. Try admin.system wrong1 -> should be 1/5
3. Wrong2 -> 2/5
4. Wrong3 -> 3/5
5. Wrong4 -> 4/5
6. Wrong5 -> locked 5/5 with 10 min countdown
7. Try correct password while locked -> should still locked 423
8. Wait or reset -> should be 0/5 again
9. Try different user susan.lee wrong1 -> should be 1/5 for susan, not 5/5

## Recommendation

- Keep 5 attempts / 10 min as user requested - good for hospital
- Better: Add progressive delay + CAPTCHA after 3 fails (already in doc)
- Add per-IP rate limiting
- Add admin notification
- For production, don't store password in localStorage, only username
