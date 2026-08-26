-- ==========================================================
-- フレネミー診断・グループ機能 テーブル定義
-- Supabaseのプロジェクトを作成後、SQL Editorでこのファイルの内容を
-- そのまま実行してください。
-- ==========================================================

-- 部屋(グループ)
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,              -- 参加用の短いコード(例: "A3F9K2")
  mode text not null check (mode in ('self', 'vote')),  -- self: 自己診断モード / vote: 匿名投票モード
  started_at timestamptz,                 -- nullの間はロビー待機中。値が入ったら全員のクイズが同時に始まる
  created_at timestamptz not null default now()
);

-- 参加者(ニックネームのみ。投票モードでは投票対象の候補にもなる)
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now()
);

-- 自己診断モードの結果(参加者ごとに1件)
create table if not exists self_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  code text not null,                     -- 判定されたタイプコード(例: "SALI")
  scores jsonb not null,                  -- {"SU":3,"AD":3,"LE":3,"IG":3}
  created_at timestamptz not null default now(),
  unique (participant_id)
);

-- 匿名投票モードの投票(1人1問につき1票)
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  question_index integer not null,        -- VOTE_QUESTIONS配列のインデックス(0〜19)
  voter_participant_id uuid not null references participants(id) on delete cascade,
  target_participant_id uuid not null references participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (voter_participant_id, question_index)  -- 同じ人が同じ問題に2回投票できないようにする
);

-- 行レベルセキュリティ(RLS)を有効化
alter table rooms enable row level security;
alter table participants enable row level security;
alter table self_results enable row level security;
alter table votes enable row level security;

-- 匿名ユーザー(anonキー)による読み書きを許可
-- 個人情報を含まないエンタメアプリのため、シンプルに全操作を許可する
create policy "anon can do everything on rooms" on rooms
  for all using (true) with check (true);
create policy "anon can do everything on participants" on participants
  for all using (true) with check (true);
create policy "anon can do everything on self_results" on self_results
  for all using (true) with check (true);
create policy "anon can do everything on votes" on votes
  for all using (true) with check (true);

-- 部屋コードでの検索を高速化
create index if not exists idx_rooms_code on rooms(code);
create index if not exists idx_participants_room on participants(room_id);
create index if not exists idx_self_results_room on self_results(room_id);
create index if not exists idx_votes_room on votes(room_id);
