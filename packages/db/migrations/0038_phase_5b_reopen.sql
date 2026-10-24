-- Reopening a store cancels its pending purge (the security review,
-- phase-5b-plan §12 PR 19): the API marks the job failed. Nothing else in
-- the app changes a job; tenant-jobs.yml runs them as the owner.
GRANT UPDATE (status, error, finished_at) ON platform.tenant_jobs TO app_rw;
