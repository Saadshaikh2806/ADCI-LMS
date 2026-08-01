-- Permission-safe search across the learning content available to the current user.

create or replace function public.adci_search_learning(
  search_query text,
  result_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with parameters as (
    select
      lower(trim(coalesce(search_query, ''))) as query,
      greatest(1, least(50, coalesce(result_limit, 20))) as maximum_results
  ),
  candidates as (
    select
      'course'::text as result_type,
      course.id as result_id,
      course.id as course_id,
      null::uuid as lesson_id,
      course.title,
      coalesce(nullif(course.description, ''), 'Course') as subtitle,
      'course'::text as content_type,
      case
        when lower(course.title) = parameters.query then 0
        when left(lower(course.title), length(parameters.query)) = parameters.query then 10
        when position(parameters.query in lower(course.title)) > 0 then 20
        else 60
      end as relevance
    from public.adci_courses course
    cross join parameters
    where parameters.query <> ''
      and course.status = 'published'
      and public.adci_can_access_course(course.id)
      and (
        position(parameters.query in lower(course.title)) > 0
        or position(parameters.query in lower(course.description)) > 0
        or position(parameters.query in lower(course.slug)) > 0
      )

    union all

    select
      'lesson'::text,
      lesson.id,
      course.id,
      lesson.id,
      lesson.title,
      course.title || ' - ' || module.title,
      lesson.lesson_type,
      case
        when lower(lesson.title) = parameters.query then 1
        when left(lower(lesson.title), length(parameters.query)) = parameters.query then 11
        when position(parameters.query in lower(lesson.title)) > 0 then 21
        when position(parameters.query in lower(module.title)) > 0 then 35
        when position(parameters.query in lower(course.title)) > 0 then 45
        else 65
      end
    from public.adci_lessons lesson
    join public.adci_modules module on module.id = lesson.module_id
    join public.adci_courses course on course.id = module.course_id
    cross join parameters
    where parameters.query <> ''
      and lesson.status = 'published'
      and course.status = 'published'
      and lesson.lesson_type <> 'quiz'
      and public.adci_can_access_course(course.id)
      and (
        position(parameters.query in lower(lesson.title)) > 0
        or position(parameters.query in lower(module.title)) > 0
        or position(parameters.query in lower(course.title)) > 0
        or exists (
          select 1
          from public.adci_article_contents article
          where article.lesson_id = lesson.id
            and position(parameters.query in lower(article.body)) > 0
        )
        or exists (
          select 1
          from public.adci_lesson_assets asset
          where asset.lesson_id = lesson.id
            and position(parameters.query in lower(asset.original_name)) > 0
        )
        or exists (
          select 1
          from public.adci_live_classes live_class
          where live_class.lesson_id = lesson.id
            and (
              position(parameters.query in lower(live_class.instructor_name)) > 0
              or position(parameters.query in lower(live_class.provider)) > 0
            )
        )
      )

    union all

    select
      'quiz'::text,
      assessment.id,
      course.id,
      assessment.lesson_id,
      assessment.title,
      course.title || ' - ' || 'Quiz',
      'quiz'::text,
      case
        when lower(assessment.title) = parameters.query then 2
        when left(lower(assessment.title), length(parameters.query)) = parameters.query then 12
        when position(parameters.query in lower(assessment.title)) > 0 then 22
        else 46
      end
    from public.adci_assessments assessment
    join public.adci_courses course on course.id = assessment.course_id
    cross join parameters
    where parameters.query <> ''
      and assessment.status = 'published'
      and course.status = 'published'
      and (assessment.available_from is null or assessment.available_from <= now())
      and (assessment.available_until is null or assessment.available_until >= now())
      and public.adci_can_access_course(course.id)
      and (
        position(parameters.query in lower(assessment.title)) > 0
        or position(parameters.query in lower(course.title)) > 0
      )

    union all

    select
      'assignment'::text,
      assignment.id,
      course.id,
      null::uuid,
      assignment.title,
      course.title || ' - ' || 'Assignment',
      'assignment'::text,
      case
        when lower(assignment.title) = parameters.query then 3
        when left(lower(assignment.title), length(parameters.query)) = parameters.query then 13
        when position(parameters.query in lower(assignment.title)) > 0 then 23
        when position(parameters.query in lower(course.title)) > 0 then 47
        else 67
      end
    from public.adci_assignments assignment
    join public.adci_courses course on course.id = assignment.course_id
    cross join parameters
    where parameters.query <> ''
      and assignment.status = 'published'
      and course.status = 'published'
      and (assignment.available_from is null or assignment.available_from <= now())
      and public.adci_can_access_course(course.id)
      and (
        position(parameters.query in lower(assignment.title)) > 0
        or position(parameters.query in lower(assignment.instructions)) > 0
        or position(parameters.query in lower(course.title)) > 0
      )
  ),
  ranked as (
    select *
    from candidates
    order by relevance, lower(title), result_type
    limit (select maximum_results from parameters)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'result_type', ranked.result_type,
    'id', ranked.result_id,
    'course_id', ranked.course_id,
    'lesson_id', ranked.lesson_id,
    'title', ranked.title,
    'subtitle', ranked.subtitle,
    'content_type', ranked.content_type
  ) order by ranked.relevance, lower(ranked.title)), '[]'::jsonb)
  from ranked;
$$;

revoke all on function public.adci_search_learning(text, integer) from public;
grant execute on function public.adci_search_learning(text, integer) to authenticated;
