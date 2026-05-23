begin;

alter table public.roadtour_runs
  alter column duplicate_policy set default 'one_participant_once_per_event';

alter table public.roadtour_runs
  drop constraint if exists roadtour_runs_duplicate_policy_check;

alter table public.roadtour_runs
  add constraint roadtour_runs_duplicate_policy_check
  check (
    duplicate_policy = any (
      array[
        'one_participant_once_per_event'::text,
        'one_participant_once_per_campaign'::text,
        'per_run'::text,
        'per_campaign'::text,
        'per_day'::text,
        'none'::text
      ]
    )
  );

commit;