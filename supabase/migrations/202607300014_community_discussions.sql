-- Protected community discussions, course questions, replies, helpful votes and moderation.
-- Run this complete file once after migration 202607300013.

create table if not exists public.adci_discussion_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adci_organizations on delete cascade,
  course_id uuid references public.adci_courses on delete cascade,
  author_id uuid not null references public.adci_profiles on delete cascade,
  category text not null default 'general'
    check (category in ('general','course_question','study_group')),
  title text not null check (char_length(trim(title)) between 3 and 180),
  body text not null check (char_length(trim(body)) between 3 and 10000),
  status text not null default 'open'
    check (status in ('open','resolved','locked','hidden')),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_discussion_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.adci_discussion_posts on delete cascade,
  author_id uuid not null references public.adci_profiles on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 10000),
  accepted boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adci_discussion_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.adci_profiles on delete cascade,
  target_type text not null check (target_type in ('post','reply')),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

alter table public.adci_discussion_posts enable row level security;
alter table public.adci_discussion_replies enable row level security;
alter table public.adci_discussion_votes enable row level security;

create or replace function public.adci_is_community_member(requested_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and (
    exists (
      select 1 from public.adci_memberships membership
      where membership.user_id = auth.uid()
        and membership.organization_id = requested_org
        and membership.active
    )
    or exists (
      select 1 from public.adci_enrolments enrolment
      join public.adci_courses course on course.id = enrolment.course_id
      where enrolment.learner_id = auth.uid()
        and course.organization_id = requested_org
        and enrolment.status in ('active','completed')
        and (enrolment.access_expires_at is null or enrolment.access_expires_at > now())
    )
  );
$$;

drop policy if exists "community members read visible discussions" on public.adci_discussion_posts;
create policy "community members read visible discussions"
on public.adci_discussion_posts for select to authenticated
using (
  status <> 'hidden'
  and public.adci_is_community_member(organization_id)
  and (course_id is null or public.adci_can_access_course(course_id))
);

drop policy if exists "moderators manage discussions" on public.adci_discussion_posts;
create policy "moderators manage discussions"
on public.adci_discussion_posts for all to authenticated
using (
  public.adci_current_user_has_role(
    organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  )
)
with check (
  public.adci_current_user_has_role(
    organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  )
);

drop policy if exists "community members read visible replies" on public.adci_discussion_replies;
create policy "community members read visible replies"
on public.adci_discussion_replies for select to authenticated
using (
  not hidden and exists (
    select 1 from public.adci_discussion_posts post
    where post.id = post_id
      and post.status <> 'hidden'
      and public.adci_is_community_member(post.organization_id)
      and (post.course_id is null or public.adci_can_access_course(post.course_id))
  )
);

drop policy if exists "moderators manage replies" on public.adci_discussion_replies;
create policy "moderators manage replies"
on public.adci_discussion_replies for all to authenticated
using (
  exists (
    select 1 from public.adci_discussion_posts post
    where post.id = post_id
      and public.adci_current_user_has_role(
        post.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
      )
  )
)
with check (
  exists (
    select 1 from public.adci_discussion_posts post
    where post.id = post_id
      and public.adci_current_user_has_role(
        post.organization_id,
        array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
      )
  )
);

drop policy if exists "users read own discussion votes" on public.adci_discussion_votes;
create policy "users read own discussion votes"
on public.adci_discussion_votes for select to authenticated
using (user_id = auth.uid());

create index if not exists adci_discussion_posts_org_activity_idx
on public.adci_discussion_posts (organization_id, pinned desc, updated_at desc);
create index if not exists adci_discussion_posts_course_idx
on public.adci_discussion_posts (course_id, updated_at desc);
create index if not exists adci_discussion_replies_post_idx
on public.adci_discussion_replies (post_id, created_at);
create index if not exists adci_discussion_votes_target_idx
on public.adci_discussion_votes (target_type, target_id);

create or replace function public.adci_get_community_feed(
  target_course_id uuid default null,
  target_filter text default 'all',
  target_search text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid; is_staff boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_is_community_member(target_organization_id)
  then raise exception 'Community access requires an active ADCI account'; end if;
  select public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support','mentor']::public.adci_app_role[]
  ) into is_staff;

  return (
    with accessible_posts as (
      select post.*, course.title as course_title
      from public.adci_discussion_posts post
      left join public.adci_courses course on course.id = post.course_id
      where post.organization_id = target_organization_id
        and post.status <> 'hidden'
        and (post.course_id is null or public.adci_can_access_course(post.course_id))
        and (target_course_id is null or post.course_id = target_course_id)
        and (
          coalesce(trim(target_search), '') = ''
          or post.title ilike '%' || trim(target_search) || '%'
          or post.body ilike '%' || trim(target_search) || '%'
        )
        and (
          target_filter = 'all'
          or (target_filter = 'mine' and post.author_id = auth.uid())
          or (target_filter = 'unanswered' and not exists (
            select 1 from public.adci_discussion_replies reply
            where reply.post_id = post.id and not reply.hidden
          ))
          or (target_filter = 'resolved' and post.status = 'resolved')
          or (target_filter = 'course_questions' and post.category = 'course_question')
        )
    ),
    post_rows as (
      select jsonb_build_object(
        'id', post.id,
        'course_id', post.course_id,
        'course_title', coalesce(post.course_title, 'ADCI Community'),
        'author_id', post.author_id,
        'author_name', coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1)),
        'author_role', coalesce((
          select membership.role::text from public.adci_memberships membership
          where membership.user_id = post.author_id
            and membership.organization_id = target_organization_id
            and membership.active
          order by case membership.role
            when 'super_admin' then 1 when 'academic_lead' then 2 when 'instructor' then 3
            when 'mentor' then 4 else 5 end
          limit 1
        ), 'student'),
        'category', post.category,
        'title', post.title,
        'body', post.body,
        'status', post.status,
        'pinned', post.pinned,
        'created_at', post.created_at,
        'updated_at', post.updated_at,
        'reply_count', (
          select count(*) from public.adci_discussion_replies reply
          where reply.post_id = post.id and not reply.hidden
        ),
        'vote_count', (
          select count(*) from public.adci_discussion_votes vote
          where vote.target_type = 'post' and vote.target_id = post.id
        ),
        'voted', exists (
          select 1 from public.adci_discussion_votes vote
          where vote.target_type = 'post' and vote.target_id = post.id and vote.user_id = auth.uid()
        ),
        'is_author', post.author_id = auth.uid(),
        'can_moderate', is_staff,
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', reply.id,
            'author_id', reply.author_id,
            'author_name', coalesce(nullif(trim(reply_profile.full_name), ''), split_part(reply_user.email::text, '@', 1)),
            'author_role', coalesce((
              select membership.role::text from public.adci_memberships membership
              where membership.user_id = reply.author_id
                and membership.organization_id = target_organization_id
                and membership.active
              order by case membership.role
                when 'super_admin' then 1 when 'academic_lead' then 2 when 'instructor' then 3
                when 'mentor' then 4 else 5 end
              limit 1
            ), 'student'),
            'body', reply.body,
            'accepted', reply.accepted,
            'created_at', reply.created_at,
            'vote_count', (
              select count(*) from public.adci_discussion_votes vote
              where vote.target_type = 'reply' and vote.target_id = reply.id
            ),
            'voted', exists (
              select 1 from public.adci_discussion_votes vote
              where vote.target_type = 'reply' and vote.target_id = reply.id and vote.user_id = auth.uid()
            ),
            'is_author', reply.author_id = auth.uid()
          ) order by reply.accepted desc, reply.created_at)
          from public.adci_discussion_replies reply
          join public.adci_profiles reply_profile on reply_profile.id = reply.author_id
          join auth.users reply_user on reply_user.id = reply.author_id
          where reply.post_id = post.id and not reply.hidden
        ), '[]'::jsonb)
      ) as payload,
      post.pinned,
      post.updated_at
      from accessible_posts post
      join public.adci_profiles profile on profile.id = post.author_id
      join auth.users user_record on user_record.id = post.author_id
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'discussions', (select count(*) from accessible_posts),
        'unanswered', (
          select count(*) from accessible_posts post
          where not exists (
            select 1 from public.adci_discussion_replies reply
            where reply.post_id = post.id and not reply.hidden
          )
        ),
        'resolved', (select count(*) from accessible_posts where status = 'resolved'),
        'my_posts', (select count(*) from accessible_posts where author_id = auth.uid())
      ),
      'courses', coalesce((
        select jsonb_agg(jsonb_build_object('id', course.id, 'title', course.title) order by course.title)
        from public.adci_courses course
        where course.organization_id = target_organization_id
          and course.status = 'published'
          and public.adci_can_access_course(course.id)
      ), '[]'::jsonb),
      'posts', coalesce((
        select jsonb_agg(payload order by pinned desc, updated_at desc) from post_rows
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.adci_create_discussion(
  discussion_course_id uuid,
  discussion_category text,
  discussion_title text,
  discussion_body text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid; saved_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_is_community_member(target_organization_id)
  then raise exception 'Community access requires an active ADCI account'; end if;
  if discussion_course_id is not null and not public.adci_can_access_course(discussion_course_id)
  then raise exception 'Course discussion is unavailable'; end if;
  if discussion_category not in ('general','course_question','study_group')
  then raise exception 'Invalid discussion category'; end if;

  insert into public.adci_discussion_posts (
    organization_id, course_id, author_id, category, title, body
  ) values (
    target_organization_id, discussion_course_id, auth.uid(), discussion_category,
    trim(discussion_title), trim(discussion_body)
  ) returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.adci_update_my_discussion(
  target_post_id uuid,
  discussion_title text,
  discussion_body text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.adci_discussion_posts
  set title = trim(discussion_title), body = trim(discussion_body), updated_at = now()
  where id = target_post_id and author_id = auth.uid() and status in ('open','resolved');
  if not found then raise exception 'Discussion cannot be edited'; end if;
end;
$$;

create or replace function public.adci_delete_my_discussion(target_post_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.adci_discussion_posts
  set status = 'hidden', pinned = false, updated_at = now()
  where id = target_post_id and author_id = auth.uid();
  if not found then raise exception 'Discussion not found'; end if;
end;
$$;

create or replace function public.adci_reply_to_discussion(
  target_post_id uuid,
  reply_body text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare post_record public.adci_discussion_posts; saved_id uuid;
begin
  select * into post_record from public.adci_discussion_posts where id = target_post_id;
  if post_record.id is null or post_record.status in ('locked','hidden')
     or not public.adci_is_community_member(post_record.organization_id)
     or (post_record.course_id is not null and not public.adci_can_access_course(post_record.course_id))
  then raise exception 'Discussion is not open for replies'; end if;
  insert into public.adci_discussion_replies (post_id, author_id, body)
  values (target_post_id, auth.uid(), trim(reply_body))
  returning id into saved_id;
  update public.adci_discussion_posts set updated_at = now() where id = target_post_id;
  return saved_id;
end;
$$;

create or replace function public.adci_delete_my_discussion_reply(target_reply_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare parent_post_id uuid; was_accepted boolean;
begin
  select post_id, accepted into parent_post_id, was_accepted
  from public.adci_discussion_replies
  where id = target_reply_id and author_id = auth.uid();
  if parent_post_id is null then raise exception 'Reply not found'; end if;
  update public.adci_discussion_replies
  set hidden = true, accepted = false, updated_at = now()
  where id = target_reply_id and author_id = auth.uid();
  if was_accepted then
    update public.adci_discussion_posts
    set status = 'open', updated_at = now()
    where id = parent_post_id and status = 'resolved';
  end if;
end;
$$;

create or replace function public.adci_toggle_discussion_vote(
  vote_target_type text,
  vote_target_id uuid
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare target_post public.adci_discussion_posts;
begin
  if vote_target_type = 'post' then
    select * into target_post from public.adci_discussion_posts where id = vote_target_id;
  elsif vote_target_type = 'reply' then
    select post.* into target_post
    from public.adci_discussion_replies reply
    join public.adci_discussion_posts post on post.id = reply.post_id
    where reply.id = vote_target_id and not reply.hidden;
  else
    raise exception 'Invalid vote target';
  end if;
  if target_post.id is null or target_post.status = 'hidden'
     or not public.adci_is_community_member(target_post.organization_id)
     or (target_post.course_id is not null and not public.adci_can_access_course(target_post.course_id))
  then raise exception 'Discussion is unavailable'; end if;

  if exists (
    select 1 from public.adci_discussion_votes
    where user_id = auth.uid() and target_type = vote_target_type and target_id = vote_target_id
  ) then
    delete from public.adci_discussion_votes
    where user_id = auth.uid() and target_type = vote_target_type and target_id = vote_target_id;
    return false;
  end if;
  insert into public.adci_discussion_votes (user_id, target_type, target_id)
  values (auth.uid(), vote_target_type, vote_target_id);
  return true;
end;
$$;

create or replace function public.adci_mark_discussion_answer(
  target_post_id uuid,
  target_reply_id uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare post_record public.adci_discussion_posts; can_manage boolean;
begin
  select * into post_record from public.adci_discussion_posts where id = target_post_id;
  select post_record.author_id = auth.uid() or public.adci_current_user_has_role(
    post_record.organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support','mentor']::public.adci_app_role[]
  ) into can_manage;
  if post_record.id is null or not can_manage
  then raise exception 'Only the discussion author or staff can accept an answer'; end if;
  if not exists (
    select 1 from public.adci_discussion_replies
    where id = target_reply_id and post_id = target_post_id and not hidden
  ) then raise exception 'Reply not found'; end if;

  update public.adci_discussion_replies set accepted = false where post_id = target_post_id;
  update public.adci_discussion_replies set accepted = true where id = target_reply_id;
  update public.adci_discussion_posts set status = 'resolved', updated_at = now()
  where id = target_post_id;
end;
$$;

create or replace function public.adci_admin_get_community()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select id into target_organization_id from public.adci_organizations where slug = 'adci';
  if not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Community moderation permission required'; end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'total', (select count(*) from public.adci_discussion_posts where organization_id = target_organization_id and status <> 'hidden'),
      'open', (select count(*) from public.adci_discussion_posts where organization_id = target_organization_id and status = 'open'),
      'unanswered', (
        select count(*) from public.adci_discussion_posts post
        where post.organization_id = target_organization_id and post.status = 'open'
          and not exists (
            select 1 from public.adci_discussion_replies reply
            where reply.post_id = post.id and not reply.hidden
          )
      ),
      'hidden', (select count(*) from public.adci_discussion_posts where organization_id = target_organization_id and status = 'hidden')
    ),
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object('id', course.id, 'title', course.title) order by course.title)
      from public.adci_courses course
      where course.organization_id = target_organization_id and course.status <> 'retired'
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', post.id,
        'course_id', post.course_id,
        'course_title', coalesce(course.title, 'ADCI Community'),
        'author_id', post.author_id,
        'author_name', coalesce(nullif(trim(profile.full_name), ''), split_part(user_record.email::text, '@', 1)),
        'author_email', user_record.email::text,
        'category', post.category,
        'title', post.title,
        'body', post.body,
        'status', post.status,
        'pinned', post.pinned,
        'created_at', post.created_at,
        'updated_at', post.updated_at,
        'reply_count', (
          select count(*) from public.adci_discussion_replies reply where reply.post_id = post.id and not reply.hidden
        ),
        'vote_count', (
          select count(*) from public.adci_discussion_votes vote where vote.target_type = 'post' and vote.target_id = post.id
        )
      ) order by post.pinned desc, post.updated_at desc)
      from public.adci_discussion_posts post
      join public.adci_profiles profile on profile.id = post.author_id
      join auth.users user_record on user_record.id = post.author_id
      left join public.adci_courses course on course.id = post.course_id
      where post.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.adci_admin_moderate_discussion(
  target_post_id uuid,
  moderation_action text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare target_organization_id uuid;
begin
  select organization_id into target_organization_id
  from public.adci_discussion_posts where id = target_post_id;
  if target_organization_id is null or not public.adci_current_user_has_role(
    target_organization_id,
    array['instructor','content_author','academic_lead','branch_admin','super_admin','support']::public.adci_app_role[]
  ) then raise exception 'Community moderation permission required'; end if;

  if moderation_action = 'pin' then
    update public.adci_discussion_posts set pinned = true, updated_at = now() where id = target_post_id;
  elsif moderation_action = 'unpin' then
    update public.adci_discussion_posts set pinned = false, updated_at = now() where id = target_post_id;
  elsif moderation_action = 'lock' then
    update public.adci_discussion_posts set status = 'locked', updated_at = now() where id = target_post_id;
  elsif moderation_action = 'unlock' then
    update public.adci_discussion_posts set status = 'open', updated_at = now() where id = target_post_id;
  elsif moderation_action = 'resolve' then
    update public.adci_discussion_posts set status = 'resolved', updated_at = now() where id = target_post_id;
  elsif moderation_action = 'reopen' then
    update public.adci_discussion_posts set status = 'open', updated_at = now() where id = target_post_id;
  elsif moderation_action = 'hide' then
    update public.adci_discussion_posts set status = 'hidden', pinned = false, updated_at = now() where id = target_post_id;
  elsif moderation_action = 'restore' then
    update public.adci_discussion_posts set status = 'open', updated_at = now() where id = target_post_id;
  else
    raise exception 'Invalid moderation action';
  end if;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    target_organization_id, auth.uid(), 'discussion.' || moderation_action,
    'discussion', target_post_id, jsonb_build_object('action', moderation_action)
  );
end;
$$;

revoke all on function public.adci_is_community_member(uuid) from public;
revoke all on function public.adci_get_community_feed(uuid,text,text) from public;
revoke all on function public.adci_create_discussion(uuid,text,text,text) from public;
revoke all on function public.adci_update_my_discussion(uuid,text,text) from public;
revoke all on function public.adci_delete_my_discussion(uuid) from public;
revoke all on function public.adci_reply_to_discussion(uuid,text) from public;
revoke all on function public.adci_delete_my_discussion_reply(uuid) from public;
revoke all on function public.adci_toggle_discussion_vote(text,uuid) from public;
revoke all on function public.adci_mark_discussion_answer(uuid,uuid) from public;
revoke all on function public.adci_admin_get_community() from public;
revoke all on function public.adci_admin_moderate_discussion(uuid,text) from public;
grant execute on function public.adci_is_community_member(uuid) to authenticated;
grant execute on function public.adci_get_community_feed(uuid,text,text) to authenticated;
grant execute on function public.adci_create_discussion(uuid,text,text,text) to authenticated;
grant execute on function public.adci_update_my_discussion(uuid,text,text) to authenticated;
grant execute on function public.adci_delete_my_discussion(uuid) to authenticated;
grant execute on function public.adci_reply_to_discussion(uuid,text) to authenticated;
grant execute on function public.adci_delete_my_discussion_reply(uuid) to authenticated;
grant execute on function public.adci_toggle_discussion_vote(text,uuid) to authenticated;
grant execute on function public.adci_mark_discussion_answer(uuid,uuid) to authenticated;
grant execute on function public.adci_admin_get_community() to authenticated;
grant execute on function public.adci_admin_moderate_discussion(uuid,text) to authenticated;
