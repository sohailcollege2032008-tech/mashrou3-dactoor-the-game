# Bug Report — Mashrou3 Dactoor THE GAME

## Context
This is a Next.js + Supabase real-time quiz app (like Kahoot). The codebase uses Supabase Auth (Google OAuth), Supabase Realtime (broadcast + postgres_changes), and Supabase RPC functions. The developer is a vibe coder — implement fixes directly, don't just explain.

---

## BUG 1 — Session lost on page refresh (HIGHEST PRIORITY)

**Files:** `stores/authStore.ts`, `app/page.tsx`, `app/auth/callback/page.tsx`

**Problem:** When the user refreshes any page, they get redirected to login again. The session should persist across refreshes like any normal website.

**Root Cause:** The `checkAuth` function uses `supabase.auth.getSession()` once on mount, but there is NO `onAuthStateChange` listener. Supabase needs this listener to properly restore sessions from localStorage after page load.

**Fix needed:**
1. In `stores/authStore.ts`: Add `supabase.auth.onAuthStateChange` listener that updates the store when auth state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, etc.)
2. In `app/auth/callback/page.tsx`: The callback page should wait for the auth state change event before redirecting, not just call `getSession()` immediately. Consider using `supabase.auth.exchangeCodeForSession()` with the URL hash/params.
3. Make sure the `onAuthStateChange` listener is set up ONCE globally (e.g., in a layout-level component or the store initialization), not in every page.

---

## BUG 2 — Realtime channel memory leak in host page

**File:** `app/host/[roomCode]/page.tsx`

**Problem:** The `setupRealtime` function creates 4 separate Supabase channels (`join-requests`, `players`, `answers`, and `room:{code}`), but the cleanup in `useEffect` only removes the last one (`channel`). The other 3 channels are never cleaned up. This causes memory leaks and duplicate event handlers if the component re-renders.

**Fix needed:**
1. Store ALL channel references (not just the game channel) so they can be cleaned up.
2. In the `useEffect` cleanup function, call `supabase.removeChannel()` on ALL channels.
3. Alternative (simpler): Combine all subscriptions into a single channel instead of creating 4 separate ones.

---

## BUG 3 — Host page crashes when status is "playing" but no question shown yet

**File:** `app/host/[roomCode]/page.tsx`

**Problem:** When the room status is `playing` and `current_question_index` is `-1` (no question started yet), the UI tries to render `room.questions.questions[-1]` which is `undefined` and crashes.

**Fix needed:**
Add a condition: only render the question UI when `current_question_index >= 0`. Show a "click to start first question" button or similar when index is -1.

---

## BUG 4 — `revealAnswer` sends stale leaderboard data

**File:** `app/host/[roomCode]/page.tsx`

**Problem:** The `revealAnswer` function broadcasts `leaderboard:update` using the current `players` state. But after `submit_answer` RPC updates scores in the database, the host's local `players` state is NOT re-fetched. So the leaderboard sent to players has OLD scores.

**Fix needed:**
In `revealAnswer`, call `fetchPlayers(room.id)` FIRST, wait for it to complete, THEN broadcast the updated `leaderboard:update` with the fresh data.

---

## BUG 5 — Room code collision possible

**Files:** `app/host/dashboard/page.tsx`, `app/host/questions/[setId]/page.tsx`

**Problem:** Room codes are generated client-side with `Math.random().toString(36).substring(2, 8).toUpperCase()`. There's no check for uniqueness. If a collision happens, the Supabase insert will fail (code has UNIQUE constraint) and the user gets a generic error.

**Fix needed:**
Either:
- Wrap the insert in a retry loop (try generating a new code if insert fails due to unique violation), OR
- Generate the code server-side in a Supabase RPC function that checks uniqueness before inserting.

---

## BUG 6 — Dead/broken code in player page

**File:** `app/play/[roomCode]/page.tsx`

**Problem:** There are TWO answer submission functions: `submitAnswer` (lines ~95-110) and `handleChoiceClick` (lines ~115-125). Only `handleChoiceClick` is actually used. The `submitAnswer` function references a parameter `p_correct_choice` that doesn't exist in the RPC. This dead code is confusing and should be removed.

**Fix needed:**
Delete the entire `submitAnswer` function. Keep only `handleChoiceClick`.

---

## BUG 7 — Join page shows stale rejected status

**File:** `app/join/page.tsx`

**Problem:** `checkExistingRequest` fetches only the LATEST join request. If a player was rejected from Room A and then tries to join Room B, they still see "your request was rejected" from Room A.

**Fix needed:**
Filter `checkExistingRequest` to only look for requests with status `pending` (not all statuses). Or filter by requests that are recent (e.g., last 24 hours).

---

## BUG 8 — No error handling on most Supabase calls

**Files:** Multiple (host dashboard, host game page, player game page, join page)

**Problem:** Most `supabase.from(...)` calls don't check the `error` return value. If any call fails (network issue, RLS denial, etc.), the app silently breaks — loading spinners spin forever, data doesn't appear, etc.

**Fix needed:**
Add basic error handling: if `error` is returned, either show a toast/alert to the user or log it and show a retry button. At minimum, stop showing infinite loading spinners.

---

## Summary — Priority Order
1. **BUG 1** (Session persistence) — This is the #1 user-facing issue
2. **BUG 2** (Channel leak) — Causes real bugs in gameplay
3. **BUG 4** (Stale leaderboard) — Wrong scores shown
4. **BUG 3** (Crash on playing with index -1) — App crash
5. **BUG 7** (Stale rejected status) — Blocks players from joining
6. **BUG 5** (Code collision) — Rare but breaks room creation
7. **BUG 6** (Dead code) — Cleanup
8. **BUG 8** (Error handling) — General robustness
