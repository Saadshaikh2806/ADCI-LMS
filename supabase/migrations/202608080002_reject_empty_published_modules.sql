-- Follow-up for databases that already ran 202608080001: published courses
-- must not contain empty modules.
create or replace function public.adci_update_course(
  target_course_id uuid,
  course_title text,
  course_description text,
  course_status public.adci_content_status
)
returns public.adci_courses
language plpgsql
security definer
set search_path = ''
as $$
declare
  course_record public.adci_courses;
  empty_module text;
  unready_lesson text;
begin
  select * into course_record
  from public.adci_courses
  where id = target_course_id;

  if course_record.id is null or not public.adci_current_user_has_role(
    course_record.organization_id,
    array['content_author','academic_lead','branch_admin','super_admin']::public.adci_app_role[]
  ) then
    raise exception 'Academic administration permission required';
  end if;

  if nullif(trim(course_title), '') is null then
    raise exception 'Course title is required';
  end if;

  if course_status = 'published' then
    select module.title into empty_module
    from public.adci_modules module
    left join public.adci_lessons lesson on lesson.module_id = module.id
    where module.course_id = target_course_id
    group by module.id, module.title, module.position
    having count(lesson.id) = 0
    order by module.position
    limit 1;

    if empty_module is not null then
      raise exception 'Add at least one lesson to module "%" before publishing', empty_module;
    end if;

    if not exists (
      select 1 from public.adci_modules module
      join public.adci_lessons lesson on lesson.module_id = module.id
      where module.course_id = target_course_id
    ) then
      raise exception 'Add at least one lesson before publishing the course';
    end if;

    select lesson.title into unready_lesson
    from public.adci_modules module
    join public.adci_lessons lesson on lesson.module_id = module.id
    where module.course_id = target_course_id
      and case lesson.lesson_type
        when 'video' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'video'
        ) and not exists (
          select 1 from public.adci_video_assets video where video.lesson_id = lesson.id
        )
        when 'audio' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'audio'
        )
        when 'pdf' then not exists (
          select 1 from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id and asset.asset_type = 'pdf'
        )
        when 'html' then not exists (
          select 1 from public.adci_article_contents article
          where article.lesson_id = lesson.id and nullif(trim(article.body), '') is not null
        )
        when 'live' then not exists (
          select 1 from public.adci_live_classes live_class where live_class.lesson_id = lesson.id
        )
        when 'quiz' then not exists (
          select 1 from public.adci_assessments assessment
          where assessment.lesson_id = lesson.id
            and assessment.status = 'published'
            and exists (
              select 1 from public.adci_assessment_questions question
              where question.assessment_id = assessment.id
            )
        )
        else true
      end
    order by module.position, lesson.position
    limit 1;

    if unready_lesson is not null then
      raise exception 'Finish the content for lesson "%" before publishing', unready_lesson;
    end if;
  end if;

  update public.adci_courses
  set title = trim(course_title),
      description = coalesce(course_description, ''),
      status = course_status,
      published_at = case
        when course_status = 'published' then coalesce(published_at, now())
        else null
      end,
      updated_at = now()
  where id = target_course_id
  returning * into course_record;

  insert into public.adci_audit_events (
    organization_id, actor_id, action, entity_type, entity_id, new_values
  ) values (
    course_record.organization_id, auth.uid(), 'course.updated', 'course',
    course_record.id,
    jsonb_build_object('title', course_record.title, 'status', course_record.status)
  );

  return course_record;
end;
$$;

revoke all on function public.adci_update_course(uuid,text,text,public.adci_content_status) from public;
grant execute on function public.adci_update_course(uuid,text,text,public.adci_content_status) to authenticated;
