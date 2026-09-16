-- STAGE 2 — BLOCKED TEMPLATE, not an automatic migration.
-- Sandbox pwpklwihwmxdehfdsoij only: confirm project in dashboard first.
-- Prerequisites: stage 1 COMMITTED; new legacy admissions denied via real Storage;
-- provider-documented AND verified drain of all pre-admitted standard/resumable/
-- signed/in-flight completion and cleanup jobs; complete retained legacy bytes
-- inventory verified after drain. See docs/cloud-image-publication.md.
-- NO sufficient provider drain evidence is currently available. DO NOT FILL
-- these fields with a sleep duration, observed quietness, or local test results.
-- No credentials in SQL. Evidence fields contain reviewed report/ticket IDs.
begin;
set local lock_timeout = '10s';
do $$
declare
  drain_reference text := '';
  legacy_reference text := '';
  operator_name text := '';
begin
  if length(btrim(drain_reference)) < 20 or length(btrim(legacy_reference)) < 20
     or length(btrim(operator_name)) < 3 then
    raise exception 'BLOCKED: verified provider drain and legacy evidence required; leave inactive';
  end if;
  update public.capture_image_cutover
    set drain_evidence=drain_reference, legacy_evidence=legacy_reference,
        verified_by=operator_name, activated_at=clock_timestamp()
    where singleton and activated_at is null;
  if not found then raise exception 'Expected exactly one inactive cutover; stop and inspect'; end if;
  if not public.capture_image_publication_ready() then
    raise exception 'Readiness checks failed; activation rolled back';
  end if;
end $$;
commit;
-- Next: verify-image-publication.sql, then bounded synthetic hosted acceptance.
-- This attestation cannot verify a report's truth. Admin review is a trust boundary.