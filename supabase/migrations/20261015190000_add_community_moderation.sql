-- Muuvi community moderation proposal.
-- REVIEW ONLY: do not execute. The actual Lovable migration pipeline is not confirmed.
-- This draft is not approved for production or test-database application.

begin;

create table if not exists public.community_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

alter table public.community_moderators enable row level security;

drop policy if exists "moderators can read own membership" on public.community_moderators;
create policy "moderators can read own membership"
  on public.community_moderators
  for select to authenticated
  using (user_id = auth.uid());

-- Administrators are a separate, higher-privilege set. Bootstrap the first admin
-- manually using the reviewed setup instructions; never infer admin status from user input.
create table if not exists public.community_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

alter table public.community_admins enable row level security;
drop policy if exists "admins can read own membership" on public.community_admins;
create policy "admins can read own membership"
  on public.community_admins
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admins can read moderator roster" on public.community_moderators;
create policy "admins can read moderator roster"
  on public.community_moderators
  for select to authenticated
  using (exists (
    select 1 from public.community_admins a where a.user_id = auth.uid()
  ));

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete restrict,
  moderator_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in ('hide', 'restore', 'remove', 'dismiss_reports')),
  previous_status text null,
  new_status text null check (new_status is null or new_status in ('visible', 'hidden', 'removed')),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  reports_affected integer not null default 0 check (reports_affected >= 0),
  created_at timestamptz not null default now()
);

create index if not exists moderation_actions_post_created_idx
  on public.moderation_actions (post_id, created_at desc);

alter table public.moderation_actions enable row level security;
drop policy if exists "moderators can read moderation history" on public.moderation_actions;
create policy "moderators can read moderation history"
  on public.moderation_actions
  for select to authenticated
  using (exists (
    select 1 from public.community_moderators m where m.user_id = auth.uid()
  ));

alter table public.posts
  add column if not exists moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'removed')),
  add column if not exists moderated_at timestamptz null,
  add column if not exists moderated_by uuid null references auth.users(id) on delete set null;

alter table public.post_reports
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'reviewed', 'dismissed')),
  add column if not exists reviewed_at timestamptz null,
  add column if not exists reviewed_by uuid null references auth.users(id) on delete set null;

create index if not exists post_reports_review_status_created_idx
  on public.post_reports (review_status, created_at asc);
create index if not exists posts_moderation_status_created_idx
  on public.posts (moderation_status, created_at desc);

-- Protected moderation fields are secured by database privileges, not a session marker.
-- Client roles receive no UPDATE grant on posts or post_reports below. The validated
-- SECURITY DEFINER RPCs perform protected updates as their trusted owner.
-- Do not add a trigger that trusts a client-settable custom GUC as proof of authorization.

-- Limit the author-name trigger to changes that actually need name resolution.
-- This avoids unrelated moderation updates touching legacy posts with missing profiles.
drop trigger if exists posts_set_author_name on public.posts;
create trigger posts_set_author_name
  before insert or update of user_id, author_name on public.posts
  for each row execute function public.set_community_author_name();

-- Public community feed: visible posts only, unless the signed-in user is a moderator.
drop policy if exists "read posts" on public.posts;
create policy "read posts"
  on public.posts for select to authenticated
  using (
    moderation_status = 'visible'
    or exists (select 1 from public.community_moderators m where m.user_id = auth.uid())
  );

-- Preserve post records: remove the existing owner-delete policy so ordinary clients
-- cannot hard-delete posts and cascade away comments, likes, reports, or audit history.
-- Moderation removal is performed only through the logical status transition below.
drop policy if exists "delete own post" on public.posts;

-- Comments and likes on hidden/removed posts are visible only to moderators.
drop policy if exists "read comments" on public.post_comments;
create policy "read comments"
  on public.post_comments for select to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id
        and (
          p.moderation_status = 'visible'
          or exists (select 1 from public.community_moderators m where m.user_id = auth.uid())
        )
    )
  );

drop policy if exists "read likes" on public.post_likes;
create policy "read likes"
  on public.post_likes for select to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_likes.post_id
        and (
          p.moderation_status = 'visible'
          or exists (select 1 from public.community_moderators m where m.user_id = auth.uid())
        )
    )
  );

-- No role may add comments or likes unless the post is visible.
-- Moderation review access does not grant permission to interact with hidden/removed posts.
drop policy if exists "own comment ins" on public.post_comments;
create policy "own comment ins"
  on public.post_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_comments.post_id
        and p.moderation_status = 'visible'
    )
  );

drop policy if exists "own like ins" on public.post_likes;
create policy "own like ins"
  on public.post_likes for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_likes.post_id
        and p.moderation_status = 'visible'
    )
  );

-- Private image access follows the visibility of the post that references the object.
drop policy if exists "post images read auth" on storage.objects;
create policy "post images read auth"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-images'
    and exists (
      select 1 from public.posts p
      where p.image_path = storage.objects.name
        and (
          p.moderation_status = 'visible'
          or exists (select 1 from public.community_moderators m where m.user_id = auth.uid())
        )
    )
  );

-- Reports are private: only moderators may read them. Report creation remains own-user-only.
drop policy if exists "moderators can read reports" on public.post_reports;
create policy "moderators can read reports"
  on public.post_reports for select to authenticated
  using (exists (
    select 1 from public.community_moderators m where m.user_id = auth.uid()
  ));

-- Moderation changes must go through this RPC. Clients cannot directly update moderation columns
-- or insert audit records. The function validates moderator membership on every invocation.
create or replace function public.moderate_community_post(
  p_post_id uuid,
  p_action text,
  p_reason text
)
returns public.posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.posts%rowtype;
  v_previous_status text;
  v_new_status text;
  v_action_id uuid;
  v_reports_affected integer := 0;
begin
  if auth.uid() is null or not exists (
    select 1 from public.community_moderators m where m.user_id = auth.uid()
  ) then
    raise exception 'Acesso restrito à moderação.' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 or length(trim(p_reason)) > 1000 then
    raise exception 'Informe um motivo entre 3 e 1000 caracteres.';
  end if;

  select * into v_post from public.posts where id = p_post_id for update;
  if not found then
    raise exception 'Publicação não encontrada.';
  end if;

  v_previous_status := v_post.moderation_status;
  case p_action
    when 'hide' then v_new_status := 'hidden';
    when 'restore' then v_new_status := 'visible';
    when 'remove' then v_new_status := 'removed';
    when 'dismiss_reports' then v_new_status := v_previous_status;
    else raise exception 'Ação de moderação inválida.';
  end case;

  if p_action <> 'dismiss_reports' then
    update public.posts
      set moderation_status = v_new_status,
          moderated_at = now(),
          moderated_by = auth.uid()
      where id = p_post_id
      returning * into v_post;
  end if;

  insert into public.moderation_actions (
    post_id, moderator_id, action, previous_status, new_status, reason
  ) values (
    p_post_id, auth.uid(), p_action, v_previous_status, v_new_status, trim(p_reason)
  ) returning id into v_action_id;

  if p_action = 'dismiss_reports' then
    update public.post_reports
      set review_status = 'dismissed', reviewed_at = now(), reviewed_by = auth.uid()
      where post_id = p_post_id and review_status = 'pending';
  else
    update public.post_reports
      set review_status = 'reviewed', reviewed_at = now(), reviewed_by = auth.uid()
      where post_id = p_post_id and review_status = 'pending';
  end if;

  get diagnostics v_reports_affected = row_count;
  update public.moderation_actions
    set reports_affected = v_reports_affected
    where id = v_action_id;

  return v_post;
end;
$$;

revoke all on function public.moderate_community_post(uuid, text, text) from public, anon;
grant execute on function public.moderate_community_post(uuid, text, text) to authenticated;

-- Only an administrator can add or remove a moderator. No client can grant itself a role.
create or replace function public.set_community_moderator(
  p_user_id uuid,
  p_is_moderator boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.community_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'Somente administradores podem gerenciar moderadores.'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Usuário inválido.';
  end if;

  if not p_is_moderator and exists (
    select 1 from public.community_admins a where a.user_id = p_user_id
  ) then
    raise exception 'Uma conta administradora não pode perder o acesso à moderação.'
      using errcode = '42501';
  end if;

  if p_is_moderator then
    insert into public.community_moderators (user_id, created_by)
    values (p_user_id, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.community_moderators where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function public.set_community_moderator(uuid, boolean) from public, anon;
grant execute on function public.set_community_moderator(uuid, boolean) to authenticated;

-- Explicit read grants for the moderator UI; row-level policies still restrict which rows are visible.
grant select on public.community_moderators to authenticated;
grant select on public.community_admins to authenticated;
grant select on public.moderation_actions to authenticated;
grant select on public.post_reports to authenticated;

-- Restrict client writes to role tables and audit history.
revoke insert, update, delete, truncate, references, trigger on public.community_moderators from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.community_admins from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.moderation_actions from public, anon, authenticated;

-- The Lovable Cloud project currently has broad table-level grants. Column-level
-- REVOKE cannot override those grants, so revoke table-level INSERT/UPDATE first,
-- then grant only the ordinary fields the client needs to create posts/reports.
-- Moderation fields can then only be changed by the SECURITY DEFINER RPC owner.
revoke insert, update, delete, truncate, references, trigger on public.posts from public, anon, authenticated;
grant insert (user_id, author_name, content, image_url, image_path) on public.posts to authenticated;

revoke insert, update, delete, truncate, references, trigger on public.post_reports from public, anon, authenticated;
grant insert (post_id, user_id, reason) on public.post_reports to authenticated;

-- No client write access to moderation/audit columns is granted.

commit;
