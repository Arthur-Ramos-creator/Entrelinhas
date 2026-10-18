-- Execute no SQL Editor do Supabase antes de configurar o frontend.
-- Para login com @usuario, publique supabase/functions/sign-in-username e configure
-- o secret APP_ORIGIN com a origem exata do site hospedado.
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Leitor(a)',
  username text,
  email text,
  avatar_url text,
  cover_url text not null default '',
  bio text not null default '',
  motivational_quote text not null default 'Disciplina hoje, liberdade amanhã.',
  social_links jsonb not null default '{}'::jsonb,
  favorite_genres text[] not null default '{}',
  preferred_theme text not null default 'dark' check (preferred_theme in ('light', 'dark')),
  level integer not null default 1 check (level > 0),
  total_points integer not null default 0 check (total_points >= 0),
  xp integer not null default 0 check (xp >= 0),
  xp_target integer not null default 500 check (xp_target > 0),
  streak integer not null default 0 check (streak >= 0),
  books_read integer not null default 0 check (books_read >= 0),
  created_at timestamptz not null default now()
);

alter table public.users add column if not exists username text;
alter table public.users add column if not exists email text;
alter table public.users add column if not exists cover_url text not null default '';
alter table public.users add column if not exists bio text not null default '';
alter table public.users add column if not exists motivational_quote text not null default 'Disciplina hoje, liberdade amanhã.';
alter table public.users add column if not exists social_links jsonb not null default '{}'::jsonb;
alter table public.users add column if not exists favorite_genres text[] not null default '{}';
alter table public.users add column if not exists preferred_theme text not null default 'dark';

update public.users as profile
set email = account.email
from auth.users as account
where profile.id = account.id and profile.email is null;

update public.users
set username = left(
  coalesce(nullif(regexp_replace(lower(split_part(coalesce(email, id::text), '@', 1)), '[^a-z0-9_]', '', 'g'), ''), 'leitor')
  || '_' || left(replace(id::text, '-', ''), 6),
  30
)
where username is null or trim(username) = '';

create unique index if not exists users_username_unique on public.users (lower(username));
alter table public.users alter column username set not null;
alter table public.users alter column username set default 'leitor';
alter table public.users alter column preferred_theme set default 'dark';

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  description text not null default '',
  points integer not null default 0 check (points >= 0),
  due_date date,
  completed boolean not null default false,
  progress integer not null default 0 check (progress between 0 and 100),
  category text not null default 'LEITURA',
  image text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.current_mission (
  user_id uuid primary key references public.users (id) on delete cascade,
  title text not null default '',
  author text not null default '',
  chapters_read integer not null default 0 check (chapters_read >= 0),
  chapters_total integer not null default 5 check (chapters_total > 0),
  progress integer not null default 0 check (progress between 0 and 100),
  pages_read integer not null default 0 check (pages_read >= 0),
  pages_total integer not null default 250 check (pages_total > 0),
  minutes_read integer not null default 0 check (minutes_read >= 0),
  created_at timestamptz not null default now()
);

alter table public.current_mission add column if not exists pages_read integer not null default 0 check (pages_read >= 0);
alter table public.current_mission add column if not exists pages_total integer not null default 250 check (pages_total > 0);
alter table public.current_mission add column if not exists minutes_read integer not null default 0 check (minutes_read >= 0);

create table if not exists public.reading_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  reading_mode text not null check (reading_mode in ('pages', 'time')),
  pages integer not null default 0 check (pages >= 0),
  minutes integer not null default 0 check (minutes >= 0),
  logged_at timestamptz not null default now(),
  constraint reading_log_has_progress check (
    (reading_mode = 'pages' and pages > 0 and minutes = 0)
    or (reading_mode = 'time' and minutes > 0 and pages = 0)
  )
);

create table if not exists public.book_clubs (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  book_title text not null,
  book_author text not null,
  week_ends date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.club_members (
  club_id uuid not null references public.book_clubs (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.users enable row level security;
alter table public.tasks enable row level security;
alter table public.current_mission enable row level security;
alter table public.reading_logs enable row level security;
alter table public.book_clubs enable row level security;
alter table public.club_members enable row level security;

grant usage on schema public to authenticated;
grant select on public.users to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, update on public.current_mission to authenticated;
grant select on public.reading_logs to authenticated;
grant select on public.book_clubs to authenticated;
grant update (name, book_title, book_author, week_ends) on public.book_clubs to authenticated;
grant select on public.club_members to authenticated;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile" on public.users for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users can create own profile" on public.users;
drop policy if exists "Users can update own profile" on public.users;

drop function if exists public.ensure_club_profile(text, text);
drop function if exists public.ensure_club_profile(text, text, text, text);
create or replace function public.ensure_club_profile(p_name text, p_username text, p_email text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_username !~ '^[A-Za-z0-9_]{3,30}$' or nullif(trim(p_email), '') is null then
    raise exception 'A valid username and email are required';
  end if;

  insert into public.users (id, name, username, email, avatar_url, level, total_points, xp, xp_target, streak, books_read)
  values (
    auth.uid(),
    coalesce(nullif(trim(p_name), ''), 'Leitor(a)'),
    lower(coalesce(nullif(trim(p_username), ''), 'leitor')),
    p_email,
    p_avatar_url,
    1, 0, 0, 500, 0, 0
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_club_profile(text, text, text, text) from public;
grant execute on function public.ensure_club_profile(text, text, text, text) to authenticated;

create or replace function public.save_club_profile(
  p_name text,
  p_username text,
  p_avatar_url text,
  p_cover_url text,
  p_bio text,
  p_motivational_quote text,
  p_social_links jsonb,
  p_favorite_genres text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(trim(p_name), '') is null or char_length(p_name) > 100
    or p_username !~ '^[A-Za-z0-9_]{3,30}$'
    or char_length(coalesce(p_bio, '')) > 500
    or char_length(coalesce(p_motivational_quote, '')) > 120 then
    raise exception 'Invalid profile fields';
  end if;

  update public.users as profile
  set name = trim(p_name),
      username = lower(p_username),
      avatar_url = coalesce(p_avatar_url, ''),
      cover_url = coalesce(p_cover_url, ''),
      bio = coalesce(p_bio, ''),
      motivational_quote = coalesce(p_motivational_quote, ''),
      social_links = coalesce(p_social_links, '{}'::jsonb),
      favorite_genres = coalesce(p_favorite_genres, '{}'::text[])
  where profile.id = auth.uid()
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found';
  end if;
  return to_jsonb(v_profile);
end;
$$;

revoke all on function public.save_club_profile(text, text, text, text, text, text, jsonb, text[]) from public;
grant execute on function public.save_club_profile(text, text, text, text, text, text, jsonb, text[]) to authenticated;

create or replace function public.save_club_theme(p_theme text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_theme not in ('light', 'dark') then
    raise exception 'Invalid theme';
  end if;
  update public.users set preferred_theme = p_theme where id = auth.uid();
  if not found then
    raise exception 'Profile not found';
  end if;
end;
$$;

revoke all on function public.save_club_theme(text) from public;
grant execute on function public.save_club_theme(text) to authenticated;

drop policy if exists "Users can read own tasks" on public.tasks;
create policy "Users can read own tasks" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own tasks" on public.tasks;
create policy "Users can create own tasks" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own mission" on public.current_mission;
create policy "Users can read own mission" on public.current_mission for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create own mission" on public.current_mission;
create policy "Users can create own mission" on public.current_mission for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update own mission" on public.current_mission;
create policy "Users can update own mission" on public.current_mission for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can read own reading logs" on public.reading_logs;
create policy "Users can read own reading logs" on public.reading_logs for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Club members can read their clubs" on public.book_clubs;
create policy "Club members can read their clubs" on public.book_clubs for select to authenticated using (
  exists (
    select 1 from public.club_members as membership
    where membership.club_id = book_clubs.id and membership.user_id = (select auth.uid())
  )
);
drop policy if exists "Club creators can update their clubs" on public.book_clubs;
create policy "Club creators can update their clubs" on public.book_clubs for update to authenticated using ((select auth.uid()) = creator_id) with check ((select auth.uid()) = creator_id);

drop policy if exists "Users can read own club memberships" on public.club_members;
create policy "Users can read own club memberships" on public.club_members for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.log_club_reading(p_mode text, p_pages integer, p_minutes integer)
returns table (reading_mode text, pages integer, minutes integer, logged_at timestamptz, pages_read integer, pages_total integer, minutes_read integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.reading_logs%rowtype;
  v_pages_read integer;
  v_pages_total integer;
  v_minutes_read integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_mode not in ('pages', 'time')
    or p_pages < 0 or p_pages > 10000
    or p_minutes < 0 or p_minutes > 1440
    or (p_mode = 'pages' and (p_pages = 0 or p_minutes <> 0))
    or (p_mode = 'time' and (p_minutes = 0 or p_pages <> 0)) then
    raise exception 'Invalid reading entry';
  end if;

  insert into public.reading_logs (user_id, reading_mode, pages, minutes)
  values (auth.uid(), p_mode, p_pages, p_minutes)
  returning * into v_log;

  update public.current_mission as mission
  set pages_read = mission.pages_read + p_pages,
      minutes_read = mission.minutes_read + p_minutes
  where mission.user_id = auth.uid()
  returning mission.pages_read, mission.pages_total, mission.minutes_read
  into v_pages_read, v_pages_total, v_minutes_read;

  if not found then
    raise exception 'Current mission not found';
  end if;

  return query select v_log.reading_mode, v_log.pages, v_log.minutes, v_log.logged_at,
    v_pages_read, v_pages_total, v_minutes_read;
end;
$$;

revoke all on function public.log_club_reading(text, integer, integer) from public;
grant execute on function public.log_club_reading(text, integer, integer) to authenticated;

create or replace function public.create_reading_club(p_name text, p_book_title text, p_book_author text, p_week_ends date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club public.book_clubs%rowtype;
  v_code text := '';
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_uuid uuid;
  v_index integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(trim(p_name), '') is null or char_length(p_name) > 60
    or nullif(trim(p_book_title), '') is null or char_length(p_book_title) > 160
    or nullif(trim(p_book_author), '') is null or char_length(p_book_author) > 120
    or p_week_ends is null then
    raise exception 'Club and weekly book details are required';
  end if;

  loop
    v_code := '';
    v_uuid := gen_random_uuid();
    for v_index in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(uuid_send(v_uuid), v_index) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.book_clubs where code = v_code);
  end loop;

  insert into public.book_clubs (creator_id, name, code, book_title, book_author, week_ends)
  values (auth.uid(), trim(p_name), v_code, trim(p_book_title), trim(p_book_author), p_week_ends)
  returning * into v_club;

  insert into public.club_members (club_id, user_id) values (v_club.id, auth.uid());

  return to_jsonb(v_club);
end;
$$;

revoke all on function public.create_reading_club(text, text, text, date) from public;
grant execute on function public.create_reading_club(text, text, text, date) to authenticated;

create or replace function public.join_reading_club(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club public.book_clubs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if p_code is null or p_code !~ '^[A-Za-z0-9]{8}$' then
    raise exception 'Invalid club code';
  end if;

  select * into v_club from public.book_clubs where code = upper(p_code);
  if not found then
    raise exception 'Club not found';
  end if;

  insert into public.club_members (club_id, user_id)
  values (v_club.id, auth.uid())
  on conflict (club_id, user_id) do nothing;

  return to_jsonb(v_club);
end;
$$;

revoke all on function public.join_reading_club(text) from public;
grant execute on function public.join_reading_club(text) to authenticated;

create or replace function public.complete_club_task(p_task_id uuid)
returns table (total_points integer, xp integer, level integer, xp_target integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_points integer;
  v_total_points integer;
  v_xp integer;
  v_level integer;
  v_xp_target integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.tasks as t
  set completed = true, progress = 100
  where t.id = p_task_id and t.user_id = auth.uid() and not t.completed
  returning t.points into v_task_points;

  if not found then
    return;
  end if;

  select u.total_points, u.xp, u.level, u.xp_target
  into v_total_points, v_xp, v_level, v_xp_target
  from public.users as u
  where u.id = auth.uid()
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  v_xp := v_xp + v_task_points;
  while v_xp >= v_xp_target loop
    v_xp := v_xp - v_xp_target;
    v_level := v_level + 1;
  end loop;
  v_total_points := v_total_points + v_task_points;

  update public.users as u
  set total_points = v_total_points, xp = v_xp, level = v_level
  where u.id = auth.uid();

  return query select v_total_points, v_xp, v_level, v_xp_target;
end;
$$;

revoke all on function public.complete_club_task(uuid) from public;
grant execute on function public.complete_club_task(uuid) to authenticated;

-- Conteúdo e papéis pertencem ao clube; tarefas concluídas e leitura continuam individuais.
alter table public.book_clubs alter column book_title set default '';
alter table public.book_clubs alter column book_author set default '';
alter table public.book_clubs alter column week_ends drop not null;
alter table public.book_clubs alter column book_title drop not null;
alter table public.book_clubs alter column book_author drop not null;

alter table public.club_members add column if not exists role text not null default 'reader';
update public.club_members as membership
set role = 'owner'
from public.book_clubs as club
where membership.club_id = club.id and membership.user_id = club.creator_id;
alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members add constraint club_members_role_check check (role in ('owner', 'admin', 'reader'));
insert into public.club_members (club_id, user_id, role)
select id, creator_id, 'owner' from public.book_clubs
on conflict (club_id, user_id) do update set role = 'owner';

create table if not exists public.club_books (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.book_clubs (id) on delete cascade,
  added_by uuid not null references public.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  author text not null check (char_length(trim(author)) between 1 and 120),
  description text not null default '',
  cover_url text not null default '',
  pages_total integer not null check (pages_total between 1 and 10000),
  week_ends date not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists club_books_one_current_per_club
  on public.club_books (club_id) where is_current;
create index if not exists club_books_club_created_idx on public.club_books (club_id, created_at desc);

create table if not exists public.club_reading_progress (
  book_id uuid not null references public.club_books (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  pages_read integer not null default 0 check (pages_read >= 0),
  minutes_read integer not null default 0 check (minutes_read >= 0),
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

create table if not exists public.club_reading_logs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.club_books (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  reading_mode text not null check (reading_mode in ('pages', 'time')),
  pages integer not null default 0 check (pages >= 0),
  minutes integer not null default 0 check (minutes >= 0),
  logged_at timestamptz not null default now(),
  constraint club_reading_log_has_progress check (
    (reading_mode = 'pages' and pages > 0 and minutes = 0)
    or (reading_mode = 'time' and minutes > 0 and pages = 0)
  )
);
create index if not exists club_reading_logs_user_book_idx
  on public.club_reading_logs (user_id, book_id, logged_at desc);

create table if not exists public.club_book_comments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.club_books (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists club_book_comments_book_created_idx on public.club_book_comments (book_id, created_at desc);

create table if not exists public.club_tasks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.book_clubs (id) on delete cascade,
  created_by uuid not null references public.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  description text not null check (char_length(trim(description)) between 1 and 500),
  points integer not null default 0 check (points between 0 and 1000),
  due_date date not null,
  category text not null default 'LEITURA',
  created_at timestamptz not null default now()
);
create index if not exists club_tasks_club_created_idx on public.club_tasks (club_id, created_at desc);

create table if not exists public.club_task_completions (
  task_id uuid not null references public.club_tasks (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.club_books enable row level security;
alter table public.club_reading_progress enable row level security;
alter table public.club_reading_logs enable row level security;
alter table public.club_book_comments enable row level security;
alter table public.club_tasks enable row level security;
alter table public.club_task_completions enable row level security;

grant select on public.club_books, public.club_tasks to authenticated;
grant select, insert on public.club_book_comments to authenticated;
grant select on public.club_reading_progress, public.club_reading_logs, public.club_task_completions to authenticated;

drop policy if exists "Members read club books" on public.club_books;
create policy "Members read club books" on public.club_books for select to authenticated using (
  exists (select 1 from public.club_members m where m.club_id = club_books.club_id and m.user_id = (select auth.uid()))
);
drop policy if exists "Members read club comments" on public.club_book_comments;
create policy "Members read club comments" on public.club_book_comments for select to authenticated using (
  exists (
    select 1 from public.club_books b join public.club_members m on m.club_id = b.club_id
    where b.id = club_book_comments.book_id and m.user_id = (select auth.uid())
  )
);
drop policy if exists "Members read own club reading progress" on public.club_reading_progress;
create policy "Members read own club reading progress" on public.club_reading_progress for select to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.club_books b join public.club_members m on m.club_id = b.club_id
    where b.id = club_reading_progress.book_id and m.user_id = (select auth.uid())
  )
);
drop policy if exists "Members read own club reading logs" on public.club_reading_logs;
create policy "Members read own club reading logs" on public.club_reading_logs for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Members read club tasks" on public.club_tasks;
create policy "Members read club tasks" on public.club_tasks for select to authenticated using (
  exists (select 1 from public.club_members m where m.club_id = club_tasks.club_id and m.user_id = (select auth.uid()))
);
drop policy if exists "Members read own task completions" on public.club_task_completions;
create policy "Members read own task completions" on public.club_task_completions for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.create_reading_club(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club public.book_clubs%rowtype;
  v_code text := '';
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_uuid uuid;
  v_index integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if nullif(trim(p_name), '') is null or char_length(trim(p_name)) > 60 then
    raise exception 'A club name between 1 and 60 characters is required';
  end if;
  loop
    v_code := '';
    v_uuid := gen_random_uuid();
    for v_index in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(uuid_send(v_uuid), v_index) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.book_clubs where code = v_code);
  end loop;
  insert into public.book_clubs (creator_id, name, code, book_title, book_author, week_ends)
  values (auth.uid(), trim(p_name), v_code, '', '', null)
  returning * into v_club;
  insert into public.club_members (club_id, user_id, role) values (v_club.id, auth.uid(), 'owner');
  return to_jsonb(v_club);
end;
$$;
revoke all on function public.create_reading_club(text) from public;
grant execute on function public.create_reading_club(text) to authenticated;
drop function if exists public.create_reading_club(text, text, text, date);

create or replace function public.get_club_members(p_club_id uuid)
returns table (user_id uuid, name text, username text, avatar_url text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid()
  ) then raise exception 'Club membership is required'; end if;
  return query
  select m.user_id, u.name, u.username, u.avatar_url, m.role, m.joined_at
  from public.club_members m join public.users u on u.id = m.user_id
  where m.club_id = p_club_id order by m.joined_at;
end;
$$;
revoke all on function public.get_club_members(uuid) from public;
grant execute on function public.get_club_members(uuid) to authenticated;

create or replace function public.set_club_weekly_book(
  p_club_id uuid, p_title text, p_author text, p_description text, p_pages_total integer, p_week_ends date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then raise exception 'Club administrator role is required'; end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 160
    or nullif(trim(p_author), '') is null or char_length(trim(p_author)) > 120
    or p_pages_total < 1 or p_pages_total > 10000 or p_week_ends is null then
    raise exception 'Invalid weekly book details';
  end if;
  perform 1 from public.book_clubs where id = p_club_id for update;
  if not found then raise exception 'Club not found'; end if;
  update public.club_books set is_current = false where club_id = p_club_id and is_current;
  insert into public.club_books (club_id, added_by, title, author, description, pages_total, week_ends)
  values (p_club_id, auth.uid(), trim(p_title), trim(p_author), coalesce(trim(p_description), ''), p_pages_total, p_week_ends)
  returning id into v_book_id;
  return v_book_id;
end;
$$;
revoke all on function public.set_club_weekly_book(uuid, text, text, text, integer, date) from public;
grant execute on function public.set_club_weekly_book(uuid, text, text, text, integer, date) to authenticated;

create or replace function public.log_club_book_reading(p_book_id uuid, p_mode text, p_pages integer, p_minutes integer)
returns table (pages_read integer, pages_total integer, minutes_read integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if p_mode not in ('pages', 'time') or p_pages < 0 or p_pages > 10000 or p_minutes < 0 or p_minutes > 1440
    or (p_mode = 'pages' and (p_pages = 0 or p_minutes <> 0))
    or (p_mode = 'time' and (p_minutes = 0 or p_pages <> 0)) then raise exception 'Invalid reading entry'; end if;
  select b.club_id into v_club_id from public.club_books b where b.id = p_book_id and b.is_current;
  if not found or not exists (select 1 from public.club_members m where m.club_id = v_club_id and m.user_id = auth.uid()) then
    raise exception 'Current club book or membership not found';
  end if;
  insert into public.club_reading_logs (book_id, user_id, reading_mode, pages, minutes)
  values (p_book_id, auth.uid(), p_mode, p_pages, p_minutes);
  insert into public.club_reading_progress (book_id, user_id, pages_read, minutes_read)
  values (p_book_id, auth.uid(), p_pages, p_minutes)
  on conflict (book_id, user_id) do update
  set pages_read = public.club_reading_progress.pages_read + excluded.pages_read,
      minutes_read = public.club_reading_progress.minutes_read + excluded.minutes_read,
      updated_at = now();
  return query
  select p.pages_read, b.pages_total, p.minutes_read
  from public.club_reading_progress p join public.club_books b on b.id = p.book_id
  where p.book_id = p_book_id and p.user_id = auth.uid();
end;
$$;
revoke all on function public.log_club_book_reading(uuid, text, integer, integer) from public;
grant execute on function public.log_club_book_reading(uuid, text, integer, integer) to authenticated;

create or replace function public.get_club_comments(p_book_id uuid)
returns table (comment_id uuid, body text, created_at timestamptz, user_id uuid, name text, username text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_books b join public.club_members m on m.club_id = b.club_id
    where b.id = p_book_id and m.user_id = auth.uid()
  ) then raise exception 'Club membership is required'; end if;
  return query
  select c.id, c.body, c.created_at, c.user_id, u.name, u.username, u.avatar_url
  from public.club_book_comments c join public.users u on u.id = c.user_id
  where c.book_id = p_book_id order by c.created_at desc limit 100;
end;
$$;
revoke all on function public.get_club_comments(uuid) from public;
grant execute on function public.get_club_comments(uuid) to authenticated;

create or replace function public.add_club_comment(p_book_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comment_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_books b join public.club_members m on m.club_id = b.club_id
    where b.id = p_book_id and b.is_current and m.user_id = auth.uid()
  ) then raise exception 'Only club members can comment on the current book'; end if;
  if nullif(trim(p_body), '') is null or char_length(trim(p_body)) > 1000 then raise exception 'Invalid comment'; end if;
  insert into public.club_book_comments (book_id, user_id, body)
  values (p_book_id, auth.uid(), trim(p_body)) returning id into v_comment_id;
  return v_comment_id;
end;
$$;
revoke all on function public.add_club_comment(uuid, text) from public;
grant execute on function public.add_club_comment(uuid, text) to authenticated;

create or replace function public.create_club_task(
  p_club_id uuid, p_title text, p_description text, p_points integer, p_due_date date, p_category text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  ) then raise exception 'Club administrator role is required'; end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 120
    or nullif(trim(p_description), '') is null or char_length(trim(p_description)) > 500
    or p_points < 0 or p_points > 1000 or p_due_date is null
    or char_length(coalesce(trim(p_category), '')) > 30 then raise exception 'Invalid club task details'; end if;
  insert into public.club_tasks (club_id, created_by, title, description, points, due_date, category)
  values (p_club_id, auth.uid(), trim(p_title), trim(p_description), p_points, p_due_date, coalesce(nullif(trim(p_category), ''), 'LEITURA'))
  returning id into v_task_id;
  return v_task_id;
end;
$$;
revoke all on function public.create_club_task(uuid, text, text, integer, date, text) from public;
grant execute on function public.create_club_task(uuid, text, text, integer, date, text) to authenticated;

create or replace function public.promote_club_admin(p_club_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.club_members m where m.club_id = p_club_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then raise exception 'Only the club owner can promote administrators'; end if;
  update public.club_members set role = 'admin'
  where club_id = p_club_id and user_id = p_member_id and role = 'reader';
  if not found then raise exception 'Eligible club member not found'; end if;
end;
$$;
revoke all on function public.promote_club_admin(uuid, uuid) from public;
grant execute on function public.promote_club_admin(uuid, uuid) to authenticated;

create or replace function public.complete_club_task(p_task_id uuid)
returns table (total_points integer, xp integer, level integer, xp_target integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
  v_task_points integer;
  v_total_points integer;
  v_xp integer;
  v_level integer;
  v_xp_target integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select t.club_id, t.points into v_club_id, v_task_points from public.club_tasks t where t.id = p_task_id;
  if not found or not exists (
    select 1 from public.club_members m where m.club_id = v_club_id and m.user_id = auth.uid()
  ) then return; end if;
  insert into public.club_task_completions (task_id, user_id)
  values (p_task_id, auth.uid()) on conflict (task_id, user_id) do nothing;
  if not found then return; end if;
  select u.total_points, u.xp, u.level, u.xp_target
  into v_total_points, v_xp, v_level, v_xp_target
  from public.users u where u.id = auth.uid() for update;
  if not found then raise exception 'Profile not found'; end if;
  v_xp := v_xp + v_task_points;
  while v_xp >= v_xp_target loop v_xp := v_xp - v_xp_target; v_level := v_level + 1; end loop;
  v_total_points := v_total_points + v_task_points;
  update public.users set total_points = v_total_points, xp = v_xp, level = v_level where id = auth.uid();
  return query select v_total_points, v_xp, v_level, v_xp_target;
end;
$$;
revoke all on function public.complete_club_task(uuid) from public;
grant execute on function public.complete_club_task(uuid) to authenticated;

create or replace function public.delete_reading_club(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  delete from public.book_clubs
  where id = p_club_id and creator_id = auth.uid();
  if not found then raise exception 'Only the club creator can delete this club'; end if;
end;
$$;
revoke all on function public.delete_reading_club(uuid) from public;
grant execute on function public.delete_reading_club(uuid) to authenticated;