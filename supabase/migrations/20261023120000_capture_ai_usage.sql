-- How much AI each Cloud account uses, per day and model, so pricing rests on
-- measured cost rather than an estimate.
--
-- Boundary:
--   * Counts only: calls and tokens. No prompt, answer or note text.
--   * No browser role can read or write it: RLS is on with no policies and
--     anon/authenticated have no privileges. Only the server's service role
--     records usage, through the function below, after a request finishes.
--   * Deleting the account deletes its rows (on delete cascade).
--   * Writes are best effort: a failed write never affects the request.
--
-- Not applied anywhere yet. Apply to a sandbox first, then production.

begin;

create table if not exists public.capture_ai_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  -- The provider tier that answered ("cerebras", "groq-2", "own-anthropic").
  provider text not null check (length(provider) between 1 and 64),
  model text not null check (length(model) between 1 and 128),
  calls integer not null default 0 check (calls >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, day, provider, model)
);

alter table public.capture_ai_usage enable row level security;
revoke all on table public.capture_ai_usage from public, anon, authenticated;
grant select on table public.capture_ai_usage to service_role;

-- Add one request's usage to the day's row, atomically.
create or replace function public.record_capture_ai_usage(
  p_owner_id uuid,
  p_day date,
  p_provider text,
  p_model text,
  p_calls integer,
  p_input_tokens bigint,
  p_output_tokens bigint
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.capture_ai_usage as usage (
    owner_id, day, provider, model, calls, input_tokens, output_tokens, updated_at
  ) values (
    p_owner_id, p_day, p_provider, p_model,
    greatest(p_calls, 0), greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), now()
  )
  on conflict (owner_id, day, provider, model) do update set
    calls = usage.calls + excluded.calls,
    input_tokens = usage.input_tokens + excluded.input_tokens,
    output_tokens = usage.output_tokens + excluded.output_tokens,
    updated_at = now();
$$;

revoke all on function public.record_capture_ai_usage(uuid, date, text, text, integer, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_capture_ai_usage(uuid, date, text, text, integer, bigint, bigint) to service_role;

commit;

-- What each account used on each day, by model (tokens; multiply by each
-- provider's price per million to get money):
--
--   select owner_id, day, provider, model, calls, input_tokens, output_tokens
--   from public.capture_ai_usage
--   where day >= current_date - 30
--   order by day desc, input_tokens + output_tokens desc;
