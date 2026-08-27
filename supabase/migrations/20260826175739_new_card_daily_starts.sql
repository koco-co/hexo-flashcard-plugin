create table public.flashcard_new_card_start (
  user_id uuid not null references auth.users (id) on delete cascade,
  date_key date not null,
  card_id text not null check (char_length(card_id) between 1 and 255),
  reset_version bigint not null check (reset_version >= 0),
  started_at_ms bigint not null check (started_at_ms >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, date_key, card_id)
);

alter table public.flashcard_new_card_start enable row level security;

create policy "Users can select their flashcard new card starts"
on public.flashcard_new_card_start
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert current flashcard new card starts"
on public.flashcard_new_card_start
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and reset_version = (
    select state.reset_version
    from public.flashcard_sync_state as state
    where state.user_id = (select auth.uid())
  )
);

create policy "Users can update current flashcard new card starts"
on public.flashcard_new_card_start
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and reset_version = (
    select state.reset_version
    from public.flashcard_sync_state as state
    where state.user_id = (select auth.uid())
  )
);

create policy "Users can delete their flashcard new card starts"
on public.flashcard_new_card_start
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.flashcard_new_card_start from anon;
grant select, insert, update, delete on table public.flashcard_new_card_start to authenticated;

create or replace function public.enforce_flashcard_new_card_daily_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_reset_version bigint;
  v_started_count bigint;
begin
  select state.reset_version
  into v_current_reset_version
  from public.flashcard_sync_state as state
  where state.user_id = new.user_id
  for update;

  if v_current_reset_version is null or new.reset_version <> v_current_reset_version then
    raise exception 'New-card start uses a stale reset version';
  end if;

  select count(*)
  into v_started_count
  from public.flashcard_new_card_start as started
  where started.user_id = new.user_id
    and started.date_key = new.date_key
    and started.reset_version = new.reset_version;

  if tg_op = 'UPDATE'
     and old.user_id = new.user_id
     and old.date_key = new.date_key
     and old.card_id = new.card_id
     and old.reset_version = new.reset_version then
    v_started_count := v_started_count - 1;
  end if;

  if v_started_count >= 50 then
    raise exception 'Daily new-card limit reached';
  end if;

  return new;
end;
$$;

create trigger flashcard_new_card_daily_limit
before insert or update on public.flashcard_new_card_start
for each row execute function public.enforce_flashcard_new_card_daily_limit();

revoke execute on function public.enforce_flashcard_new_card_daily_limit() from public, anon, authenticated;

create or replace function public.sync_flashcard_progress(
  p_progress jsonb,
  p_reset_version bigint default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_server_reset_version bigint;
  v_card record;
  v_day record;
  v_task record;
  v_new_day record;
  v_new_card record;
  v_last_review_ms bigint;
  v_started_count bigint;
  v_cards jsonb;
  v_days jsonb;
  v_new_card_days jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_reset_version is null or p_reset_version < 0 then
    raise exception 'Invalid reset version';
  end if;

  insert into public.flashcard_sync_state (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select state.reset_version
  into v_server_reset_version
  from public.flashcard_sync_state as state
  where state.user_id = v_user_id
  for update;

  if p_reset_version > v_server_reset_version then
    raise exception 'Client reset version is ahead of the server';
  end if;

  if p_reset_version = v_server_reset_version then
    for v_card in
      select entry.key, entry.value
      from jsonb_each(
        case
          when jsonb_typeof(p_progress -> 'cards') = 'object' then p_progress -> 'cards'
          else '{}'::jsonb
        end
      ) as entry
    loop
      if char_length(v_card.key) between 1 and 255 and jsonb_typeof(v_card.value) = 'object' then
        v_last_review_ms := case
          when jsonb_typeof(v_card.value -> 'last_review') = 'number'
            then (v_card.value ->> 'last_review')::bigint
          else null
        end;

        insert into public.flashcard_card_progress (
          user_id,
          card_id,
          reset_version,
          progress,
          last_review_ms
        )
        values (
          v_user_id,
          v_card.key,
          v_server_reset_version,
          v_card.value,
          v_last_review_ms
        )
        on conflict (user_id, card_id) do update
        set progress = excluded.progress,
            last_review_ms = excluded.last_review_ms,
            reset_version = excluded.reset_version,
            updated_at = now()
        where coalesce(excluded.last_review_ms, 0) > coalesce(public.flashcard_card_progress.last_review_ms, 0);
      end if;
    end loop;

    for v_day in
      select entry.key, entry.value
      from jsonb_each(
        case
          when jsonb_typeof(p_progress -> 'days') = 'object' then p_progress -> 'days'
          else '{}'::jsonb
        end
      ) as entry
    loop
      if v_day.key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(v_day.value -> 'cards') = 'object' then
        for v_task in
          select entry.key, entry.value
          from jsonb_each(v_day.value -> 'cards') as entry
        loop
          if char_length(v_task.key) between 1 and 255
             and jsonb_typeof(v_task.value) = 'object'
             and jsonb_typeof(v_task.value -> 'due') = 'number' then
            insert into public.flashcard_day_task (
              user_id,
              date_key,
              card_id,
              reset_version,
              due_ms,
              completed_at_ms
            )
            values (
              v_user_id,
              v_day.key::date,
              v_task.key,
              v_server_reset_version,
              (v_task.value ->> 'due')::bigint,
              case
                when jsonb_typeof(v_task.value -> 'completedAt') = 'number'
                  then (v_task.value ->> 'completedAt')::bigint
                else null
              end
            )
            on conflict (user_id, date_key, card_id) do update
            set due_ms = least(public.flashcard_day_task.due_ms, excluded.due_ms),
                completed_at_ms = case
                  when public.flashcard_day_task.completed_at_ms is null then excluded.completed_at_ms
                  when excluded.completed_at_ms is null then public.flashcard_day_task.completed_at_ms
                  else greatest(public.flashcard_day_task.completed_at_ms, excluded.completed_at_ms)
                end,
                reset_version = excluded.reset_version,
                updated_at = now();
          end if;
        end loop;
      end if;
    end loop;

    for v_new_day in
      select entry.key, entry.value
      from jsonb_each(
        case
          when jsonb_typeof(p_progress -> 'newCardDays') = 'object' then p_progress -> 'newCardDays'
          else '{}'::jsonb
        end
      ) as entry
    loop
      if v_new_day.key ~ '^\d{4}-\d{2}-\d{2}$'
         and jsonb_typeof(v_new_day.value -> 'started') = 'object' then
        for v_new_card in
          select entry.key, entry.value
          from jsonb_each(v_new_day.value -> 'started') as entry
        loop
          if char_length(v_new_card.key) between 1 and 255
             and jsonb_typeof(v_new_card.value) = 'number'
             and (v_new_card.value #>> '{}')::bigint >= 0 then
            if exists (
              select 1
              from public.flashcard_new_card_start as started
              where started.user_id = v_user_id
                and started.date_key = v_new_day.key::date
                and started.card_id = v_new_card.key
                and started.reset_version = v_server_reset_version
            ) then
              update public.flashcard_new_card_start as started
              set started_at_ms = least(started.started_at_ms, (v_new_card.value #>> '{}')::bigint),
                  updated_at = now()
              where started.user_id = v_user_id
                and started.date_key = v_new_day.key::date
                and started.card_id = v_new_card.key
                and started.reset_version = v_server_reset_version;
            else
              select count(*)
              into v_started_count
              from public.flashcard_new_card_start as started
              where started.user_id = v_user_id
                and started.date_key = v_new_day.key::date
                and started.reset_version = v_server_reset_version;

              if v_started_count < 50 then
                insert into public.flashcard_new_card_start (
                  user_id,
                  date_key,
                  card_id,
                  reset_version,
                  started_at_ms
                )
                values (
                  v_user_id,
                  v_new_day.key::date,
                  v_new_card.key,
                  v_server_reset_version,
                  (v_new_card.value #>> '{}')::bigint
                );
              end if;
            end if;
          end if;
        end loop;
      end if;
    end loop;

    update public.flashcard_sync_state
    set updated_at = now()
    where user_id = v_user_id;
  end if;

  select coalesce(jsonb_object_agg(card.card_id, card.progress), '{}'::jsonb)
  into v_cards
  from public.flashcard_card_progress as card
  where card.user_id = v_user_id
    and card.reset_version = v_server_reset_version;

  select coalesce(jsonb_object_agg(day_rows.date_key, jsonb_build_object('cards', day_rows.cards)), '{}'::jsonb)
  into v_days
  from (
    select task.date_key::text as date_key,
           jsonb_object_agg(
             task.card_id,
             jsonb_build_object(
               'due', task.due_ms,
               'completedAt', task.completed_at_ms
             )
           ) as cards
    from public.flashcard_day_task as task
    where task.user_id = v_user_id
      and task.reset_version = v_server_reset_version
    group by task.date_key
  ) as day_rows;

  select coalesce(jsonb_object_agg(day_rows.date_key, jsonb_build_object('started', day_rows.started)), '{}'::jsonb)
  into v_new_card_days
  from (
    select started.date_key::text as date_key,
           jsonb_object_agg(started.card_id, started.started_at_ms) as started
    from public.flashcard_new_card_start as started
    where started.user_id = v_user_id
      and started.reset_version = v_server_reset_version
    group by started.date_key
  ) as day_rows;

  return jsonb_build_object(
    'progress', jsonb_build_object(
      'version', 3,
      'cards', v_cards,
      'days', v_days,
      'newCardDays', v_new_card_days
    ),
    'resetVersion', v_server_reset_version
  );
end;
$$;

create or replace function public.reset_flashcard_progress()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reset_version bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  insert into public.flashcard_sync_state (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  update public.flashcard_sync_state
  set reset_version = reset_version + 1,
      updated_at = now()
  where user_id = v_user_id
  returning reset_version into v_reset_version;

  delete from public.flashcard_card_progress
  where user_id = v_user_id;

  delete from public.flashcard_day_task
  where user_id = v_user_id;

  delete from public.flashcard_new_card_start
  where user_id = v_user_id;

  return jsonb_build_object(
    'progress', jsonb_build_object(
      'version', 3,
      'cards', '{}'::jsonb,
      'days', '{}'::jsonb,
      'newCardDays', '{}'::jsonb
    ),
    'resetVersion', v_reset_version
  );
end;
$$;

revoke execute on function public.sync_flashcard_progress(jsonb, bigint) from public, anon;
revoke execute on function public.reset_flashcard_progress() from public, anon;
grant execute on function public.sync_flashcard_progress(jsonb, bigint) to authenticated;
grant execute on function public.reset_flashcard_progress() to authenticated;
