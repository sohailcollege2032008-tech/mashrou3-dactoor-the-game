-- 001_initial_schema.sql
-- Setup Tables, RLS, Functions, and Triggers for Mashrou3 Dactoor THE GAME

-- Table: authorized_hosts
CREATE TABLE authorized_hosts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(100),
  added_by UUID NOT NULL, -- always the owner's auth.uid
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: profiles
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

-- Table: question_sets (Question Bank)
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

-- Table: rooms
CREATE TABLE rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(6) UNIQUE NOT NULL,
  host_id UUID REFERENCES profiles(id) NOT NULL,
  question_set_id UUID REFERENCES question_sets(id), -- link to saved question set
  title TEXT NOT NULL,
  questions JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'lobby' CHECK (status IN ('lobby', 'playing', 'revealing', 'finished')),
  current_question_index INTEGER DEFAULT -1,
  question_started_at TIMESTAMPTZ,
  requires_approval BOOLEAN DEFAULT true, -- host must approve players
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_host ON rooms(host_id);

-- Table: join_requests
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

-- Table: players
CREATE TABLE players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  nickname VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  score INTEGER DEFAULT 0,
  is_connected BOOLEAN DEFAULT true,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_players_room ON players(room_id);

-- Table: answers
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

-- Enable RLS on all tables
ALTER TABLE authorized_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;

-- ========== authorized_hosts RLS ==========
CREATE POLICY "Anyone can read hosts" ON authorized_hosts FOR SELECT USING (true);
CREATE POLICY "Owner can insert hosts" ON authorized_hosts FOR INSERT WITH CHECK (auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com');
CREATE POLICY "Owner can update hosts" ON authorized_hosts FOR UPDATE USING (auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com');
CREATE POLICY "Owner can delete hosts" ON authorized_hosts FOR DELETE USING (auth.jwt()->>'email' = 'sohailcollege2032008@gmail.com');

-- ========== profiles RLS ==========
CREATE POLICY "Anyone can read profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (id = auth.uid());

-- ========== question_sets RLS ==========
CREATE POLICY "Hosts can read own question sets" ON question_sets FOR SELECT USING (host_id = auth.uid());
CREATE POLICY "Hosts can insert question sets" ON question_sets FOR INSERT WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts can update own question sets" ON question_sets FOR UPDATE USING (host_id = auth.uid());
CREATE POLICY "Hosts can delete own question sets" ON question_sets FOR DELETE USING (host_id = auth.uid());

-- ========== rooms RLS ==========
CREATE POLICY "Anyone can read rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Hosts can create rooms" ON rooms FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'host')));
CREATE POLICY "Host can update own room" ON rooms FOR UPDATE USING (host_id = auth.uid());

-- ========== join_requests RLS ==========
CREATE POLICY "Host can read room requests" ON join_requests FOR SELECT USING (room_id IN (SELECT id FROM rooms WHERE host_id = auth.uid()) OR player_id = auth.uid());
CREATE POLICY "Players can create join requests" ON join_requests FOR INSERT WITH CHECK (player_id = auth.uid());
CREATE POLICY "Host can update requests" ON join_requests FOR UPDATE USING (room_id IN (SELECT id FROM rooms WHERE host_id = auth.uid()));

-- ========== players RLS ==========
CREATE POLICY "Anyone can read players" ON players FOR SELECT USING (true);
CREATE POLICY "System inserts players" ON players FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM join_requests WHERE join_requests.room_id = players.room_id AND join_requests.player_id = players.user_id AND join_requests.status = 'approved'));
CREATE POLICY "Players can update own record" ON players FOR UPDATE USING (user_id = auth.uid());

-- ========== answers RLS ==========
CREATE POLICY "Anyone can read answers" ON answers FOR SELECT USING (true);
CREATE POLICY "Players can submit answers" ON answers FOR INSERT WITH CHECK (player_id IN (SELECT id FROM players WHERE user_id = auth.uid()));

-- submit_answer RPC (atomic, race-condition-safe)
CREATE OR REPLACE FUNCTION submit_answer(
  p_room_id UUID,
  p_player_id UUID,
  p_question_index INTEGER,
  p_selected_choice INTEGER,
  p_reaction_time_ms INTEGER
) RETURNS JSONB AS $$
DECLARE
  v_is_correct BOOLEAN;
  v_is_first BOOLEAN;
  v_existing_first UUID;
  v_correct_choice INTEGER;
BEGIN
  -- التحقق مما إذا كان اللاعب قد أجاب بالفعل
  IF EXISTS (
    SELECT 1 FROM answers
    WHERE room_id = p_room_id AND player_id = p_player_id AND question_index = p_question_index
  ) THEN
    RETURN jsonb_build_object('error', 'already_answered');
  END IF;

  -- fetch correct choice from room
  SELECT (questions->'questions'->p_question_index->>'correct')::INTEGER INTO v_correct_choice 
  FROM rooms WHERE id = p_room_id;

  v_is_correct := (p_selected_choice = v_correct_choice);
  v_is_first := false;

  IF v_is_correct THEN
    -- حماية من التزامن (Race condition) لمنع فوز شخصين في نفس اللحظة
    PERFORM pg_advisory_xact_lock(hashtext(p_room_id::TEXT || p_question_index::TEXT));

    SELECT player_id INTO v_existing_first
    FROM answers
    WHERE room_id = p_room_id AND question_index = p_question_index AND is_first_correct = true
    LIMIT 1;

    IF v_existing_first IS NULL THEN
      v_is_first := true;
    END IF;
  END IF;

  -- تسجيل الإجابة مع إضافة وقت رد الفعل القادم من المتصفح
  INSERT INTO answers (room_id, player_id, question_index, selected_choice, is_correct, is_first_correct, response_time_ms)
  VALUES (p_room_id, p_player_id, p_question_index, p_selected_choice, v_is_correct, v_is_first, p_reaction_time_ms);

  -- زيادة السكور للفائز الأول
  IF v_is_first THEN
    UPDATE players SET score = score + 1 WHERE id = p_player_id;
  END IF;

  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'is_first', v_is_first,
    'response_time_ms', p_reaction_time_ms
  );
END;
$$ LANGUAGE plpgsql;

-- process_join_request RPC (host approves/rejects)
CREATE OR REPLACE FUNCTION process_join_request(
  p_request_id UUID,
  p_action VARCHAR(20) -- 'approved' or 'rejected'
) RETURNS JSONB AS $$
DECLARE
  v_request RECORD;
BEGIN
  SELECT * INTO v_request FROM join_requests WHERE id = p_request_id;

  IF v_request IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_processed', 'status', v_request.status);
  END IF;

  -- Update request status
  UPDATE join_requests
  SET status = p_action, reviewed_at = now()
  WHERE id = p_request_id;

  -- If approved, add player to the room
  IF p_action = 'approved' THEN
    BEGIN
      INSERT INTO players (room_id, user_id, nickname, avatar_url)
      VALUES (v_request.room_id, v_request.player_id, v_request.player_name, v_request.player_avatar);
    EXCEPTION WHEN OTHERS THEN
      -- Revert status if insert fails
      UPDATE join_requests SET status = 'pending', reviewed_at = NULL WHERE id = p_request_id;
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_action, 'player_id', v_request.player_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Database function to sync role on host add/remove:
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
