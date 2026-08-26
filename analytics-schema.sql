-- ==========================================================
-- フレネミー診断・匿名アクセス解析 テーブル定義
-- group-schema.sql を実行済みの同じSupabaseプロジェクトに、
-- 追加でこの内容をSQL Editorで実行してください。
--
-- 個人を特定する情報(IPアドレス、端末情報、ニックネームなど)は
-- 一切記録しません。「いつ・何のイベントが・どのタイプで」
-- 起きたかという匿名の集計データのみを記録します。
--
-- 記録(insert)は診断を使う全員ができますが、集計データの閲覧(select)は
-- Supabase Authでログインしたユーザーだけに制限しています。
-- ==========================================================

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,   -- 'quiz_start' / 'quiz_complete' / 'share_image' / 'share_compat_image' /
                               -- 'share_line' / 'share_compat_line' / 'share_x' / 'download_image' /
                               -- 'download_compat_image' / 'copy_text'
  type_code text,             -- quiz_complete時のみ、判定されたタイプコード(例: "SALI")。他イベントはnull
  created_at timestamptz not null default now()
);

alter table analytics_events enable row level security;

-- 匿名ユーザーからの記録(insert)を許可 — 診断アプリ自身はログインしないため必要
create policy "anon can insert analytics events" on analytics_events
  for insert with check (true);

-- 集計データの読み取り(select)は、ログイン済みユーザーのみに制限する。
-- ダッシュボード(admin.html)はSupabase Authでログインしたユーザーだけが
-- データを読めるようにするための設定。
create policy "only authenticated users can read analytics events" on analytics_events
  for select using (auth.role() = 'authenticated');

create index if not exists idx_analytics_events_type on analytics_events(event_type);
create index if not exists idx_analytics_events_created on analytics_events(created_at);
