-- Agora is the only supported provider for new live sessions.
do $$
begin
  if to_regprocedure('public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz)') is not null then
    execute 'revoke execute on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz) from anon, authenticated';
  end if;

  if to_regprocedure('public.adci_schedule_daily_live_classes(uuid,text,text,text,timestamptz,timestamptz,date)') is not null then
    execute 'revoke execute on function public.adci_schedule_daily_live_classes(uuid,text,text,text,timestamptz,timestamptz,date) from anon, authenticated';
  end if;
end;
$$;
