-- Agora is the only supported provider for new live sessions.
revoke execute on function public.adci_save_live_class(uuid,text,text,text,timestamptz,timestamptz)
from anon, authenticated;

revoke execute on function public.adci_schedule_daily_live_classes(uuid,text,text,text,timestamptz,timestamptz,date)
from anon, authenticated;
