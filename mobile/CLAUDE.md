# CLAUDE.md — MED ROYALE MOBILE (Flutter Android)

> Local workspace instructions for Med Royale Mobile App.

---

## 🎯 Project Identity
**Name:** Med Royale Mobile (Android App)
**Package:** `com.mashrou3dactoor.med_royale_mobile`
**Brand Identity:** Academic, Editorial, Medical Competitive Trivia Platform
**Owner/Lead:** Sohail Ahmed (`sohailcollege2032008@gmail.com`)

---

## 🛠 Tech Stack
| Layer | Technology |
|---|---|
| Framework | Flutter 3.41.x (Dart 3.11.x) |
| Architecture | Feature-First (Data, Domain, Presentation) |
| State Management | Riverpod / StateNotifiers |
| Routing | GoRouter |
| UI & Typography | Google Fonts (Fraunces, IBM Plex Sans Arabic, Inter Tight, JetBrains Mono) |
| Backend & Auth | Firebase Auth (Google Sign-In), Cloud Firestore, Realtime Database (RTDB), Cloud Storage |
| AI Processing | Google Cloud Run (`https://dactoor-processor-285933625241.europe-west1.run.app`) |
| Math Rendering | flutter_math_fork |
| Audio | audioplayers |

---

## 🛡️ Anti-Cheat & Security System
1. **Screen Capture & Recording Prevention**:
   - `FLAG_SECURE` (`WindowManager.LayoutParams.FLAG_SECURE`) strictly enabled on the Android window in `MainActivity.kt`.
   - Prevents screenshots, screen recorders, recent apps task snapshot leak.
2. **App Backgrounding / Switch Penalty**:
   - `AppLifecycleListener` / `SecurityService`: If the player leaves the app (app paused, minimized, or lost focus) during an active question countdown (Duels, Host Game, Tournaments):
     - The current question is immediately marked as **Forfeited (0 points)**.
     - Anti-cheat warning alert is shown to the user.
3. **Floating Apps / Overlays / Split-Screen Shield**:
   - If an overlay / floating popup is detected or window loses active focus:
     - The app renders an opaque privacy shield (`SecurityShieldVeil`).
     - Any interaction outside pure full-screen forfeits the active question.

---

## 🗃 Firebase Database Schemas
- **Firestore `profiles/{uid}`**: `{ id, email, display_name, avatar_url, role: 'owner'|'host'|'player', created_at }`
- **Firestore `question_sets/{id}`**: `{ host_id, title, questions: { questions: [...] }, question_count, is_global, tags, force_rtl }`
- **RTDB `duels/{duelId}`**: `{ status: 'waiting'|'playing'|'revealing'|'finished', current_question_index, question_started_at, players, answers, forfeit_by, surrender_by }`
- **RTDB `rooms/{code}`**: `{ code, host_id, status: 'lobby'|'question'|'revealing'|'finished', current_question_index, reveal_data, config, force_rtl }`
- **RTDB `duel_presence/{duelId}/{uid}`**: `{ connected: boolean }`

---

## 🎨 Design Tokens & System
- Light Surface: `#F4F1EA` (paper), `#EDE8DB` (paper-2), `#E4DDCC` (paper-3)
- Dark Surface: `#14120E` (paper), `#1C1A14` (paper-2), `#26231B` (paper-3)
- Ink: `#1A1A1A` (ink), `#3B3B38` (ink-2), `#6F6C63` (ink-3), `#9E9B90` (ink-4)
- Accents: Burgundy (`#9C3B2E`), Navy (`#2D3E5C`), Gold (`#B08944`), Success (`#3C6E47`), Alert (`#B5432C`)
- Choices: A (Burgundy), B (Navy), C (Gold), D (Success)
- Strict RTL for Arabic text, LTR for host dashboard and code displays.
