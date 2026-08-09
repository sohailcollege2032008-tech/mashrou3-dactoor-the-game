> # ⚠️ OUTDATED — SUPERSEDED (Supabase era, April 2026)
> This PRD describes the OLD Supabase stack. The current system is Firebase (Auth + Firestore + RTDB + Storage)
> with Python Cloud Functions and the tournament system. Read docs/ARCHITECTURE.md instead.
> Keep this file only as historical reference.

---

# Mashrou3 Dactoor THE GAME — Technical PRD v2

## 1. Product Overview

**Name:** Mashrou3 Dactoor THE GAME
**Type:** Real-time competitive quiz web application (like Kahoot but "first correct answer wins the point")
**Tech Stack:** React (Vite) + Supabase (Auth with Google OAuth, Realtime, Database, Storage) + Tailwind CSS + Google Gemini API (for file-to-JSON conversion)
**Target Users:** Medical students (Arabic-speaking, up to ~100 concurrent players per session)
**Deployment:** Vercel (frontend) + Supabase Free Tier (backend)

### Core Concept
A host creates a quiz room, uploads questions (JSON directly, or any document file like PDF/PPTX/DOCX that gets auto-converted to JSON via Gemini AI), and starts the game. Players sign in with Google, join via a room code, and must be approved by the host. Questions appear one at a time — the **first** player to answer correctly scores the point. The host controls question progression.

---

## 2. User Roles & Authorization Hierarchy

### Owner (المالك) — Super Admin
- **Hardcoded email:** `sohailcollege2032008@gmail.com`
- Only ONE owner exists in the system
- Can add or remove host emails via an **Owner Dashboard**
- Can see all rooms, all hosts, all activity
- Is automatically also a host (can create and run games)

### Host (المضيف) — Authorized Quiz Masters
- Must be explicitly added by the Owner (by email)
- Signs in via Google OAuth — system checks if their email is in the `authorized_hosts` table
- Can create game rooms, upload/manage questions, run games
- Can approve or reject player join requests for their rooms
- Has a personal **Question Bank** (saved question sets they can reuse)
- Cannot add other hosts (only the Owner can)

### Player (اللاعب) — Participants
- Signs in via Google OAuth (mandatory — no anonymous access)
- Can browse available rooms and request to join
- Must wait for host approval before entering the game lobby
- If rejected by host, CANNOT send another join request for that specific room
- Sees each question, answers, sees leaderboard, sees final results

### Authorization Flow Summary
```
Owner (sohailcollege2032008@gmail.com)
  └── adds Host emails to authorized_hosts table
        └── Host signs in with Google → verified against authorized_hosts
              └── Host creates room → Players request to join
                    └── Host approves/rejects each request
                          └── Approved players enter lobby
```

---

## 3. Authentication System

### Google OAuth Setup (Supabase Auth)

All users (Owner, Hosts, Players) sign in with Google. The system determines their role post-login:

```
User signs in with Google
  → Fetch email from auth.users
  → IF email === 'sohailcollege2032008@gmail.com' → role = 'owner'
  → ELSE IF email IN authorized_hosts → role = 'host'
  → ELSE → role = 'player'
```

**Supabase Auth Config:**
- Enable Google OAuth provider in Supabase Dashboard → Authentication → Providers → Google
- Set up Google Cloud OAuth consent screen + credentials
- Redirect URL: `https://your-project.supabase.co/auth/v1/callback`

**Client-side login:**
```js
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: window.location.origin + '/auth/callback'
  }
})
```

**Post-login role resolution:**
```js
async function getUserRole(userId) {
  const { data: { user } } = await supabase.auth.getUser()
  const email = user.email

  if (email === 'sohailcollege2032008@gmail.com') return 'owner'

  const { data: host } = await supabase
    .from('authorized_hosts')
    .select('id')
    .eq('email', email)
    .single()

  return host ? 'host' : 'player'
}
```

---

## 4. Question Upload System (JSON + AI File Conversion)

### Method 1: Direct JSON Upload
The host uploads a `.json` file with this exact structure:

```json
{
  "title": "MSK Anatomy Quiz - Batch 62",
  "questions": [
    {
      "id": 1,
      "question": "Which muscle is the primary flexor of the elbow?",
      "question_ar": "إيه العضلة الأساسية اللي بتعمل flexion للكوع؟",
      "choices": [
        "Biceps brachii",
        "Brachioradialis",
        "Brachialis",
        "Pronator teres"
      ],
      "correct": 2,
      "time_limit": 15,
      "image_url": null
    }
  ]
}
```

**Field definitions:**
| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Quiz title shown in lobby |
| `questions` | array | Yes | Array of question objects |
| `questions[].id` | number | Yes | Sequential question ID |
| `questions[].question` | string | Yes | Question text (English or bilingual) |
| `questions[].question_ar` | string | No | Optional Arabic version of question |
| `questions[].choices` | string[] | Yes | Array of 2-5 answer choices |
| `questions[].correct` | number | Yes | **0-indexed** position of the correct answer |
| `questions[].time_limit` | number | No | Seconds allowed per question (default: 20) |
| `questions[].image_url` | string | No | Optional image URL to display with question |

### Method 2: AI-Powered File Conversion (PDF, PPTX, DOCX, etc.)

The host can upload **any document file** containing questions. The system sends it to the **Google Gemini API** which extracts and converts the questions into the JSON schema above.

**Supported file types:** `.pdf`, `.pptx`, `.docx`, `.doc`, `.txt`, `.xlsx`, `.csv`, `.png`, `.jpg` (image of questions)

**Conversion Flow:**
```
Host uploads file (e.g., exam.pdf)
  → Frontend reads file as base64
  → Sends to Supabase Edge Function: convert-questions
  → Edge Function calls Gemini API with:
      - The file (as base64 inline_data or text)
      - A system prompt (see below)
  → Gemini returns structured JSON
  → Edge Function validates the JSON against the schema
  → Returns parsed questions to frontend
  → Host sees a REVIEW/EDIT screen with all extracted questions
  → Host can edit any question, fix errors, remove questions, adjust time limits
  → Host confirms → questions are saved to Question Bank
```

**Gemini System Prompt for Conversion:**
```
You are a medical exam question extractor. You receive a document (PDF, PPTX, DOCX, image, etc.) that contains multiple-choice questions (MCQs).

Your task is to extract ALL questions from the document and return them in this EXACT JSON format. Return ONLY valid JSON, no markdown, no explanation.

{
  "title": "<infer a title from the document content>",
  "questions": [
    {
      "id": 1,
      "question": "<the question text in its original language>",
      "question_ar": "<Arabic version if the original is in Arabic, otherwise null>",
      "choices": ["<choice A>", "<choice B>", "<choice C>", "<choice D>"],
      "correct": <0-indexed position of the correct answer>,
      "time_limit": 20,
      "image_url": null
    }
  ]
}

RULES:
1. Extract every single MCQ from the document — do not skip any.
2. The "correct" field must be the 0-based index of the correct answer in the choices array.
3. If the correct answer is marked/highlighted/bolded/starred in the document, use that. If no answer is marked as correct, set "correct" to -1 and the host will manually set it.
4. If the question is in Arabic, put it in both "question" and "question_ar". If in English, put in "question" only.
5. Preserve the original wording of questions and choices exactly as written.
6. If choices are labeled A/B/C/D or 1/2/3/4, remove the labels and just keep the text.
7. Set time_limit to 20 for normal questions, 30 for long/complex ones, 10 for simple recall.
8. Return ONLY the JSON object. No markdown backticks, no commentary.
```

**Edge Function: `convert-questions`**
```js
// Supabase Edge Function
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY'))

Deno.serve(async (req) => {
  const { file_base64, file_mime_type, file_name } = await req.json()

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const result = await model.generateContent([
    { text: SYSTEM_PROMPT }, // the prompt above
    {
      inlineData: {
        mimeType: file_mime_type,
        data: file_base64
      }
    }
  ])

  const responseText = result.response.text()
  const parsed = JSON.parse(responseText)

  // Validate schema
  if (!parsed.title || !Array.isArray(parsed.questions)) {
    return new Response(JSON.stringify({ error: 'Invalid AI response' }), { status: 422 })
  }

  return new Response(JSON.stringify(parsed), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

**Environment variable needed:**
```env
GEMINI_API_KEY=your-gemini-api-key
```

### Validation Rules (both methods):
- File must produce valid JSON matching the schema
- Must have `title` (string) and `questions` (non-empty array)
- Each question must have `question`, `choices` (min 2), and `correct` (valid index or -1)
- If any question has `correct: -1`, the review screen highlights it in red and forces the host to set the correct answer before saving
- Show clear validation errors in Arabic if anything is malformed

---

## 5. Question Bank System

Every host has a persistent personal question bank stored in Supabase.

### Features:
- **Auto-save:** Every time a host uploads questions (JSON or AI-converted), they're automatically saved to their bank
- **Browse & Search:** Host can browse all their saved question sets, search by title or question text
- **Edit:** Host can open any saved set, edit individual questions (text, choices, correct answer, time limit), add new questions, delete questions
- **Quick Start:** Host can select any saved question set and instantly create a new game room with it — no re-upload needed
- **Delete:** Host can delete entire question sets they no longer need
- **Duplicate:** Host can duplicate a set to create a modified version

### Question Bank UI (Host Dashboard):
```
/host/dashboard
├── "Create New Game" button
├── "Upload Questions" button (JSON or file)
├── Question Bank list:
│   ├── [MSK Anatomy Quiz - Batch 62] — 25 questions — Created: 2026-04-01
│   │   ├── [Start Game] [Edit] [Duplicate] [Delete]
│   │   └── Expandable: preview first 3 questions
│   ├── [Neuroanatomy Final - 2026] — 40 questions — Created: 2026-03-15
│   │   └── ...
│   └── ...
└── Pagination / infinite scroll
```

---

## 6. Join Request & Approval System

### Flow:
```
Player signs in with Google
  → Enters room code
  → System creates a join_request with status = 'pending'
  → Player sees: "طلبك قيد المراجعة... في انتظار موافقة المضيف" (Your request is under review...)
  → Host sees the request in real-time in the lobby with player's:
      - Google display name
      - Google profile picture
      - Email
  → Host clicks [Accept ✓] or [Reject ✗]
  → IF accepted:
      - join_request.status = 'approved'
      - Player is added to the `players` table
      - Player's UI transitions to the lobby
      - Player appears in the lobby player grid
  → IF rejected:
      - join_request.status = 'rejected'
      - Player sees: "تم رفض طلبك. لا يمكنك الانضمام لهذه المسابقة." (Your request was rejected.)
      - The "Request to Join" button is disabled/hidden
      - Player CANNOT submit another request for this room (enforced by DB unique constraint + status check)
```

### Real-time Updates:
- Host sees new join requests via Supabase Realtime subscription on `join_requests` table (filtered by room_id)
- Player subscribes to their own join_request row to get instant status updates
- Optional: Host can "Accept All" button to bulk-approve all pending requests

---

## 7. Supabase Database Schema

### Table: `authorized_hosts`
```sql
CREATE TABLE authorized_hosts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(100),
  added_by UUID NOT NULL, -- always the owner's auth.uid
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the owner as a host too
-- (done programmatically on first owner login)
```

### Table: `profiles`
```sql
-- Auto-populated on first Google sign-in via a trigger
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(100),
  avatar_url TEXT,
  role VARCHAR(20) DEFAULT 'player' CHECK (role IN ('owner', 'host', 'player')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role VARCHAR(20);
BEGIN
  -- Determine role
  IF NEW.email = 'sohailcollege2032008@gmail.com' THEN
    v_role := 'owner';
  ELSIF EXISTS (SELECT 1 FROM authorized_hosts WHERE email = NEW.email AND is_active = true) THEN
    v_role := 'host';
  ELSE
    v_role := 'player';
  END IF;

  INSERT INTO profiles (id, email, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    v_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

### Table: `question_sets` (Question Bank)
```sql
CREATE TABLE question_sets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  host_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  question_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(questions->'questions')) STORED,
  source_type VARCHAR(20) DEFAULT 'json' CHECK (source_type IN ('json', 'pdf', 'pptx', 'docx', 'xlsx', 'image', 'other')),
  source_filename TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_question_sets_host ON question_sets(host_id);
```

### Table: `rooms`
```sql
CREATE TABLE rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  host_id UUID REFERENCES profiles(id) NOT NULL,
  question_set_id UUID REFERENCES question_sets(id), -- link to saved question set
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'lobby' CHECK (status IN ('lobby', 'playing', 'finished')),
  current_question_index INTEGER DEFAULT -1,
  question_started_at TIMESTAMPTZ,
  requires_approval BOOLEAN DEFAULT true, -- host must approve players
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_host ON rooms(host_id);
```

### Table: `join_requests`
```sql
CREATE TABLE join_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  player_email VARCHAR(255) NOT NULL,
  player_name VARCHAR(100),
  player_avatar TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, player_id) -- one request per player per room
);

CREATE INDEX idx_join_requests_room ON join_requests(room_id, status);
CREATE INDEX idx_join_requests_player ON join_requests(player_id);
```

### Table: `players`
```sql
CREATE TABLE players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  nickname VARCHAR(30) NOT NULL,
  avatar_url TEXT,
  score INTEGER DEFAULT 0,
  is_connected BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_players_room ON players(room_id);
```

### Table: `answers`
```sql
CREATE TABLE answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  question_index INTEGER NOT NULL,
  selected_choice INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL,
  is_first_correct BOOLEAN DEFAULT false,
  answered_at TIMESTAMPTZ DEFAULT now(),
  response_time_ms INTEGER,
  UNIQUE(room_id, player_id, question_index)
);

CREATE INDEX idx_answers_first ON answers(room_id, question_index, is_first_correct) WHERE is_first_correct = true;
CREATE INDEX idx_answers_player ON answers(player_id, question_index);
```

### Row Level Security (RLS) Policies

```sql
-- Enable RLS on all tables
ALTER TABLE authorized_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

-- ========== authorized_hosts ==========
-- Only owner can manage hosts
CREATE POLICY "Anyone can read hosts" ON authorized_hosts
  FOR SELECT USING (true);
CREATE POLICY "Owner can insert hosts" ON authorized_hosts
  FOR INSERT WITH CHECK (
    auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com'
  );
CREATE POLICY "Owner can update hosts" ON authorized_hosts
  FOR UPDATE USING (
    auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com'
  );
CREATE POLICY "Owner can delete hosts" ON authorized_hosts
  FOR DELETE USING (
    auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com'
  );

-- ========== profiles ==========
CREATE POLICY "Anyone can read profiles" ON profiles
  FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ========== question_sets ==========
CREATE POLICY "Hosts can read own question sets" ON question_sets
  FOR SELECT USING (host_id = auth.uid());
CREATE POLICY "Hosts can insert question sets" ON question_sets
  FOR INSERT WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts can update own question sets" ON question_sets
  FOR UPDATE USING (host_id = auth.uid());
CREATE POLICY "Hosts can delete own question sets" ON question_sets
  FOR DELETE USING (host_id = auth.uid());

-- ========== rooms ==========
CREATE POLICY "Anyone can read rooms" ON rooms
  FOR SELECT USING (true);
CREATE POLICY "Hosts can create rooms" ON rooms
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'host'))
  );
CREATE POLICY "Host can update own room" ON rooms
  FOR UPDATE USING (host_id = auth.uid());

-- ========== join_requests ==========
CREATE POLICY "Host can read room requests" ON join_requests
  FOR SELECT USING (
    room_id IN (SELECT id FROM rooms WHERE host_id = auth.uid())
    OR player_id = auth.uid()
  );
CREATE POLICY "Players can create join requests" ON join_requests
  FOR INSERT WITH CHECK (player_id = auth.uid());
CREATE POLICY "Host can update requests" ON join_requests
  FOR UPDATE USING (
    room_id IN (SELECT id FROM rooms WHERE host_id = auth.uid())
  );

-- ========== players ==========
CREATE POLICY "Anyone can read players" ON players
  FOR SELECT USING (true);
CREATE POLICY "System inserts players" ON players
  FOR INSERT WITH CHECK (
    -- Only allow insert if the player has an approved join_request
    EXISTS (
      SELECT 1 FROM join_requests
      WHERE join_requests.room_id = players.room_id
        AND join_requests.player_id = players.user_id
        AND join_requests.status = 'approved'
    )
  );
CREATE POLICY "Players can update own record" ON players
  FOR UPDATE USING (user_id = auth.uid());

-- ========== answers ==========
CREATE POLICY "Anyone can read answers" ON answers
  FOR SELECT USING (true);
CREATE POLICY "Players can submit answers" ON answers
  FOR INSERT WITH CHECK (
    player_id IN (SELECT id FROM players WHERE user_id = auth.uid())
  );
```

### Database Function: `submit_answer` (atomic, race-condition-safe)

```sql
CREATE OR REPLACE FUNCTION submit_answer(
  p_room_id UUID,
  p_player_id UUID,
  p_question_index INTEGER,
  p_selected_choice INTEGER,
  p_correct_choice INTEGER
) RETURNS JSONB AS $$
DECLARE
  v_is_correct BOOLEAN;
  v_is_first BOOLEAN;
  v_existing_first UUID;
  v_response_time INTEGER;
  v_question_started TIMESTAMPTZ;
BEGIN
  -- Check if player already answered this question
  IF EXISTS (
    SELECT 1 FROM answers
    WHERE room_id = p_room_id AND player_id = p_player_id AND question_index = p_question_index
  ) THEN
    RETURN jsonb_build_object('error', 'already_answered');
  END IF;

  v_is_correct := (p_selected_choice = p_correct_choice);

  SELECT question_started_at INTO v_question_started FROM rooms WHERE id = p_room_id;
  v_response_time := EXTRACT(MILLISECONDS FROM (now() - v_question_started))::INTEGER;

  v_is_first := false;
  IF v_is_correct THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_room_id::TEXT || p_question_index::TEXT));

    SELECT player_id INTO v_existing_first
    FROM answers
    WHERE room_id = p_room_id AND question_index = p_question_index AND is_first_correct = true
    LIMIT 1;

    IF v_existing_first IS NULL THEN
      v_is_first := true;
    END IF;
  END IF;

  INSERT INTO answers (room_id, player_id, question_index, selected_choice, is_correct, is_first_correct, response_time_ms)
  VALUES (p_room_id, p_player_id, p_question_index, p_selected_choice, v_is_correct, v_is_first, v_response_time);

  IF v_is_first THEN
    UPDATE players SET score = score + 1 WHERE id = p_player_id;
  END IF;

  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'is_first', v_is_first,
    'response_time_ms', v_response_time
  );
END;
$$ LANGUAGE plpgsql;
```

### Database Function: `process_join_request` (host approves/rejects)

```sql
CREATE OR REPLACE FUNCTION process_join_request(
  p_request_id UUID,
  p_action VARCHAR(20) -- 'approved' or 'rejected'
) RETURNS JSONB AS $$
DECLARE
  v_request RECORD;
BEGIN
  SELECT * INTO v_request FROM join_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('error', 'request_not_found');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'already_processed');
  END IF;

  -- Update request status
  UPDATE join_requests
  SET status = p_action, reviewed_at = now()
  WHERE id = p_request_id;

  -- If approved, add player to the room
  IF p_action = 'approved' THEN
    INSERT INTO players (room_id, user_id, nickname, avatar_url)
    VALUES (v_request.room_id, v_request.player_id, v_request.player_name, v_request.player_avatar);
  END IF;

  RETURN jsonb_build_object('status', p_action, 'player_id', v_request.player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 8. Supabase Realtime Channels Strategy

### Channel: `room:{room_code}`

**Events the host broadcasts:**

| Event | Payload | Description |
|---|---|---|
| `game:start` | `{ total_questions }` | Game has started |
| `question:show` | `{ index, question, choices, time_limit, image_url, question_ar }` | New question (no correct answer sent) |
| `question:lock` | `{ index }` | Time's up, no more answers |
| `question:result` | `{ index, correct, first_player_id, first_player_name, stats }` | Reveal answer + who got it first |
| `leaderboard:update` | `{ rankings: [{player_id, nickname, score, rank}] }` | Updated leaderboard |
| `game:end` | `{ final_rankings }` | Game over |
| `join:approved` | `{ player_id }` | Player approved (sent to specific player) |
| `join:rejected` | `{ player_id }` | Player rejected (sent to specific player) |

**Events players broadcast:**

| Event | Payload | Description |
|---|---|---|
| `player:answered` | `{ player_id, question_index }` | Player submitted answer |
| `player:left` | `{ player_id }` | Player disconnected |

### Presence
```js
const channel = supabase.channel(`room:${roomCode}`)
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState()
})
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    await channel.track({ player_id, nickname, avatar_url })
  }
})
```

### Join Request Real-time (Host side)
```js
// Host subscribes to new join requests for their room
supabase
  .channel('join-requests')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'join_requests',
    filter: `room_id=eq.${roomId}`
  }, (payload) => {
    // New join request arrived — show in UI
    addPendingRequest(payload.new)
  })
  .subscribe()
```

### Join Request Real-time (Player side)
```js
// Player subscribes to their own request status
supabase
  .channel('my-request')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'join_requests',
    filter: `id=eq.${myRequestId}`
  }, (payload) => {
    if (payload.new.status === 'approved') {
      // Transition to lobby
    } else if (payload.new.status === 'rejected') {
      // Show rejection message, disable rejoin
    }
  })
  .subscribe()
```

---

## 9. Game Flow (State Machine)

```
LOBBY → PLAYING → FINISHED
         ↕
    (per question cycle):
    QUESTION_SHOWN → ANSWERING → LOCKED → RESULT → (next or FINISHED)
```

### Full Flow Including Auth & Join Requests:

1. **Host signs in with Google** → role verified as host/owner → sees Host Dashboard
2. **Host selects questions** (from bank or new upload) → creates room → gets 6-char code
3. **Players sign in with Google** → enter room code → submit join request
4. **Host sees requests** in real-time → approves or rejects each one
5. **Approved players** enter lobby → appear in player grid via Presence
6. **Rejected players** see rejection message, cannot re-request
7. **Host clicks "Start Game"** → room status = `playing` → broadcasts `game:start`
8. **Host clicks "Next Question"**:
   - Updates `rooms.current_question_index` + `rooms.question_started_at`
   - Broadcasts `question:show` (WITHOUT correct answer)
   - Countdown timer starts
9. **Players answer** → `submit_answer()` RPC → atomic first-correct determination
10. **Timer expires / Host clicks "Lock"** → broadcasts `question:lock`
11. **Host clicks "Reveal"** → broadcasts `question:result` + `leaderboard:update`
12. **Repeat 8-11** until all questions done
13. **Host clicks "End Game"** → `game:end` → final leaderboard + celebration

---

## 10. Frontend Architecture

### Tech Stack
- **Framework:** React 18+ with Vite
- **Styling:** Tailwind CSS 3+
- **State:** Zustand
- **Router:** React Router v6
- **Supabase Client:** `@supabase/supabase-js` v2
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Confetti:** `canvas-confetti`

### Routes & Pages

```
/                         → Landing page (Sign in with Google)
/auth/callback            → OAuth callback handler

-- Owner routes (protected: role === 'owner')
/owner/dashboard          → Manage authorized hosts (add/remove emails)

-- Host routes (protected: role === 'owner' OR 'host')
/host/dashboard           → Question bank + create game
/host/upload              → Upload questions (JSON or file)
/host/questions/:setId    → Edit/review a question set
/host/:roomCode           → Lobby (approve/reject requests) → Game Control → Results

-- Player routes (protected: role === 'player')
/join                     → Enter room code → submit join request
/play/:roomCode           → Waiting for approval → Lobby → Game → Results
```

### Component Tree

```
App
├── AuthCallback (handles OAuth redirect)
├── LandingPage
│   ├── HeroSection (animated logo + tagline)
│   └── GoogleSignInButton
│
├── OwnerDashboard
│   ├── HostList (all authorized hosts with remove button)
│   ├── AddHostForm (email input + add button)
│   └── ActivityLog (optional: recent games, player counts)
│
├── HostDashboard
│   ├── CreateGameButton
│   ├── UploadQuestionsButton
│   ├── QuestionBankList
│   │   ├── QuestionSetCard (title, count, date, actions)
│   │   │   ├── StartGameButton
│   │   │   ├── EditButton
│   │   │   ├── DuplicateButton
│   │   │   └── DeleteButton
│   │   └── EmptyState
│   └── RecentGamesHistory (optional)
│
├── QuestionUploadPage
│   ├── FileDropzone (accepts .json, .pdf, .pptx, .docx, .xlsx, .png, .jpg)
│   ├── ProcessingIndicator (shown during AI conversion)
│   ├── QuestionReviewEditor
│   │   ├── QuestionCard (editable: question text, choices, correct answer, time)
│   │   ├── AddQuestionButton
│   │   ├── DeleteQuestionButton
│   │   └── UnsetAnswerWarning (for questions with correct: -1)
│   └── SaveToBank + StartGameButton
│
├── HostGamePage
│   ├── JoinRequestsPanel
│   │   ├── PendingRequestCard (name, email, avatar, [Accept] [Reject])
│   │   ├── ApproveAllButton
│   │   └── RequestCount badge
│   ├── LobbyView
│   │   ├── RoomCodeDisplay (large, copyable, shareable)
│   │   ├── ApprovedPlayerGrid
│   │   └── StartGameButton
│   ├── GameControlView
│   │   ├── QuestionDisplay
│   │   ├── TimerBar
│   │   ├── AnswerTracker
│   │   ├── NextQuestion / Lock / Reveal buttons
│   │   └── LiveLeaderboardSidebar
│   └── ResultsView
│       ├── FinalLeaderboard
│       ├── StatsOverview
│       └── PlayAgainButton
│
├── PlayerJoinPage
│   ├── RoomCodeInput
│   ├── SubmitRequestButton
│   ├── PendingApprovalView ("في انتظار موافقة المضيف...")
│   └── RejectedView ("تم رفض طلبك")
│
├── PlayerGamePage
│   ├── WaitingView (lobby)
│   ├── QuestionView
│   │   ├── QuestionText
│   │   ├── ChoiceButtons (large, colorful, mobile-optimized)
│   │   ├── TimerBar
│   │   └── FeedbackOverlay (✓ First! / ✓ Correct / ✗ Wrong)
│   ├── LeaderboardView
│   └── FinalResultsView
│
└── SharedComponents
    ├── Timer
    ├── Leaderboard
    ├── GoogleAvatar
    ├── ProtectedRoute (role-based)
    └── LoadingSpinner
```

---

## 11. UI/UX Design Specifications

### Design Direction: Energetic Medical Gaming

**Theme:** Dark background (#0A0E1A) with neon medical-green (#00F5A0) as primary accent, electric blue (#00D4FF) as secondary, warm amber (#FFB800) for warnings/timers.

**Typography:**
- Display/Headlines: `"Clash Display"` or a bold distinctive display font
- Body/UI: `"Cairo"` (Arabic-first, supports both Arabic and English)
- Monospace (room codes): `"JetBrains Mono"`

**Choice button colors:**
- Choice A: #FF6B6B (red)
- Choice B: #4ECDC4 (teal)
- Choice C: #FFE66D (yellow)
- Choice D: #A78BFA (purple)

**Key patterns:**
- Room code: MASSIVE (8rem+), monospace, glow effect, one-tap copy
- Timer: horizontal bar that shrinks + changes color (green → yellow → red)
- "First correct" celebration: screen flash + gold badge
- RTL throughout (dir="rtl" on Arabic text)
- Mobile-first (players on phones), host view optimized for 1080p+
- Join request cards: player's Google avatar + name + email + approve/reject buttons
- Question review editor: inline editing with save/discard per question

---

## 12. Owner Dashboard Specifications

### Add Host Flow:
```
Owner navigates to /owner/dashboard
  → Sees list of all authorized hosts (email, name, date added, active status)
  → Types a new email in the "Add Host" input
  → Clicks "Add" → email inserted into authorized_hosts
  → If that person has already signed in → their profile.role is updated to 'host'
  → If that person hasn't signed in yet → when they sign in, the trigger assigns role = 'host'
```

### Remove Host Flow:
```
Owner clicks "Remove" next to a host
  → Confirmation dialog: "هل أنت متأكد من إزالة هذا المضيف؟"
  → Sets authorized_hosts.is_active = false
  → Updates profiles.role = 'player' for that email
  → Host can no longer create rooms (existing rooms remain accessible to finish)
```

### Database function to sync role on host add/remove:
```sql
CREATE OR REPLACE FUNCTION sync_host_role()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.is_active = true) THEN
    UPDATE profiles SET role = 'host' WHERE email = NEW.email AND role = 'player';
  ELSIF TG_OP = 'UPDATE' AND NEW.is_active = false THEN
    UPDATE profiles SET role = 'player' WHERE email = NEW.email AND role = 'host';
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET role = 'player' WHERE email = OLD.email AND role = 'host';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_host_change
  AFTER INSERT OR UPDATE OR DELETE ON authorized_hosts
  FOR EACH ROW EXECUTE FUNCTION sync_host_role();
```

---

## 13. Environment Variables

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Gemini API (for Edge Function — set in Supabase Dashboard → Edge Functions → Secrets)
GEMINI_API_KEY=your-gemini-api-key

# Owner email (also hardcoded in DB policies for security)
VITE_OWNER_EMAIL=sohailcollege2032008@gmail.com
```

---

## 14. Supabase Project Setup Instructions

1. **Create Supabase project** (Free tier)
2. **Enable Google OAuth:** Dashboard → Authentication → Providers → Google
   - Set up Google Cloud Console: OAuth consent screen + credentials
   - Add redirect URL: `https://your-project.supabase.co/auth/v1/callback`
3. **Run all migrations** from Section 7 in the SQL Editor (in order)
4. **Enable Realtime** on tables: `join_requests`, `rooms`, `players`, `answers`
5. **Deploy Edge Function** `convert-questions` for Gemini file conversion
6. **Set Edge Function secrets:** `GEMINI_API_KEY`
7. **Enable RLS** — all policies from Section 7

---

## 15. Project Structure

```
mashrou3-dactoor/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── lib/
│   │   ├── supabase.js            # Supabase client init + Google auth
│   │   ├── realtime.js             # Channel management helpers
│   │   ├── gemini.js               # File upload → Edge Function call
│   │   └── utils.js                # Room code generator, time helpers
│   ├── stores/
│   │   ├── authStore.js            # Auth state + role
│   │   ├── gameStore.js            # Game state
│   │   └── questionBankStore.js    # Question sets CRUD
│   ├── hooks/
│   │   ├── useAuth.js              # Auth + role resolution
│   │   ├── useRoom.js              # Room CRUD + subscription
│   │   ├── useGameChannel.js       # Realtime channel hook
│   │   ├── useJoinRequests.js      # Join request management
│   │   ├── useQuestionBank.js      # Question set CRUD
│   │   └── useTimer.js             # Countdown timer
│   ├── pages/
│   │   ├── Landing.jsx
│   │   ├── AuthCallback.jsx
│   │   ├── owner/
│   │   │   └── Dashboard.jsx       # Manage hosts
│   │   ├── host/
│   │   │   ├── Dashboard.jsx       # Question bank + create game
│   │   │   ├── Upload.jsx          # Upload JSON or file
│   │   │   ├── QuestionEditor.jsx  # Edit question set
│   │   │   └── Game.jsx            # Lobby + game control
│   │   ├── player/
│   │   │   ├── Join.jsx            # Enter code + request
│   │   │   └── Game.jsx            # Play the game
│   │   └── NotAuthorized.jsx
│   ├── components/
│   │   ├── ui/                     # Buttons, inputs, cards, modals
│   │   ├── auth/
│   │   │   ├── GoogleSignInButton.jsx
│   │   │   └── ProtectedRoute.jsx  # Role-based route guard
│   │   ├── game/
│   │   │   ├── QuestionDisplay.jsx
│   │   │   ├── ChoiceButton.jsx
│   │   │   ├── Timer.jsx
│   │   │   ├── Leaderboard.jsx
│   │   │   ├── RoomCode.jsx
│   │   │   ├── PlayerGrid.jsx
│   │   │   ├── FeedbackOverlay.jsx
│   │   │   ├── JoinRequestCard.jsx
│   │   │   └── JoinRequestsPanel.jsx
│   │   ├── questions/
│   │   │   ├── FileDropzone.jsx
│   │   │   ├── QuestionCard.jsx    # Editable question component
│   │   │   └── QuestionSetCard.jsx # Bank list item
│   │   └── layout/
│   │       ├── GameLayout.jsx
│   │       └── DashboardLayout.jsx
│   └── styles/
│       └── globals.css
├── supabase/
│   ├── migrations/
│   │   ├── 001_create_profiles.sql
│   │   ├── 002_create_authorized_hosts.sql
│   │   ├── 003_create_question_sets.sql
│   │   ├── 004_create_rooms.sql
│   │   ├── 005_create_join_requests.sql
│   │   ├── 006_create_players.sql
│   │   ├── 007_create_answers.sql
│   │   ├── 008_create_rls_policies.sql
│   │   ├── 009_create_functions.sql
│   │   └── 010_create_triggers.sql
│   └── functions/
│       └── convert-questions/
│           └── index.ts
├── package.json
├── vite.config.js
├── tailwind.config.js
└── .env.local
```

---

## 16. Sample JSON File for Testing

```json
{
  "title": "MSK Anatomy Speed Quiz - Batch 62",
  "questions": [
    {
      "id": 1,
      "question": "Which nerve passes through the carpal tunnel?",
      "choices": ["Ulnar nerve", "Median nerve", "Radial nerve", "Musculocutaneous nerve"],
      "correct": 1,
      "time_limit": 15
    },
    {
      "id": 2,
      "question": "The rotator cuff does NOT include which muscle?",
      "choices": ["Supraspinatus", "Infraspinatus", "Deltoid", "Teres minor"],
      "correct": 2,
      "time_limit": 15
    },
    {
      "id": 3,
      "question": "Which bone is most commonly fractured in the wrist?",
      "choices": ["Lunate", "Scaphoid", "Triquetrum", "Capitate"],
      "correct": 1,
      "time_limit": 12
    },
    {
      "id": 4,
      "question": "The femoral triangle is bounded laterally by which muscle?",
      "choices": ["Adductor longus", "Pectineus", "Sartorius", "Gracilis"],
      "correct": 2,
      "time_limit": 15
    },
    {
      "id": 5,
      "question": "Foot drop results from injury to which nerve?",
      "choices": ["Tibial nerve", "Common fibular nerve", "Femoral nerve", "Obturator nerve"],
      "correct": 1,
      "time_limit": 12
    }
  ]
}
```

---

## 17. Acceptance Criteria (Definition of Done)

### Auth & Roles
- [ ] Google OAuth sign-in works for all users
- [ ] Owner (sohailcollege2032008@gmail.com) is automatically detected and gets owner role
- [ ] Owner can add/remove host emails from the Owner Dashboard
- [ ] When a new host email is added and that user signs in, they get host role automatically
- [ ] When a host email is removed, that user's role reverts to player
- [ ] Players cannot access host or owner routes (ProtectedRoute enforced)
- [ ] Hosts cannot access owner routes

### Join Request System
- [ ] Players must submit a join request to enter a room
- [ ] Host sees new requests in real-time with player name, email, and avatar
- [ ] Host can approve or reject each request
- [ ] Approved players immediately enter the lobby
- [ ] Rejected players see rejection message and CANNOT re-request
- [ ] "Accept All" bulk-approve works correctly

### Question Upload & AI Conversion
- [ ] Host can upload .json files with correct schema validation
- [ ] Host can upload .pdf, .pptx, .docx, .xlsx, .png, .jpg files
- [ ] Non-JSON files are sent to Gemini API and converted to JSON schema
- [ ] Host sees a review/edit screen after AI conversion
- [ ] Questions with undetected correct answers (correct: -1) are highlighted
- [ ] Host can edit question text, choices, correct answer, and time limit
- [ ] Host must set all correct answers before saving

### Question Bank
- [ ] All uploaded question sets are saved to host's personal bank
- [ ] Host can browse, search, edit, duplicate, and delete question sets
- [ ] Host can start a game directly from a saved question set
- [ ] Question bank persists across sessions

### Game Flow
- [ ] Host can create room and gets 6-character code
- [ ] Questions appear simultaneously for all approved players
- [ ] Countdown timer is synced (±1 second tolerance)
- [ ] First correct answer determined atomically server-side (no race conditions)
- [ ] Player gets immediate feedback
- [ ] Leaderboard updates in real-time
- [ ] Final results with celebration for top 3
- [ ] 100 concurrent players: no crashes, no missed events, no duplicate points

### UI/UX
- [ ] Works on mobile (360px+) and desktop (1080p+)
- [ ] Arabic text renders correctly in RTL
- [ ] No correct answer data leaked to client before reveal
- [ ] Disconnected player can rejoin and resume

---

## 18. Critical Implementation Rules

### DO:
- **Use `submit_answer` RPC** for answer submission — never direct insert
- **Use `process_join_request` RPC** for approving/rejecting — ensures atomic player insertion
- **Broadcast question data WITHOUT correct answer** — only reveal in `question:result`
- **Validate all files on upload** with clear Arabic error messages
- **Use server timestamps** for all time-sensitive operations
- **Store question sets in `question_sets` table** — not just in rooms
- **Check `join_requests` status before allowing re-request** — if rejected, block
- **Support RTL** with `dir="rtl"` and Cairo font throughout
- **Use Google profile data** (name, avatar) for player display

### DON'T:
- **Never send correct answers to clients** before reveal
- **Never trust client-side** "I was first" claims
- **Never allow unauthenticated access** — all users must sign in with Google
- **Never let a non-host create rooms** — enforce via RLS
- **Never let a rejected player re-request** — enforce via DB constraint + UI
- **Don't hardcode the owner check only in frontend** — enforce in RLS policies too
- **Don't allow host to be a player** simultaneously

---

## 19. Performance & Scalability Notes

- **Supabase Free Tier: 200 concurrent Realtime connections** — 100 players + host well within limits
- **Broadcast** (not DB changes) for game events — faster, no DB overhead
- **Advisory locks** in PostgreSQL — handles thousands of concurrent txns, no bottleneck for 100 players
- **Gemini API:** Use `gemini-2.0-flash` for fast file conversion (~2-5 seconds per file)
- **Question bank:** JSONB column is efficient for Postgres, no need for normalized question tables at this scale
- **Keep Realtime payloads small** — send indexes, let clients reference local cache
