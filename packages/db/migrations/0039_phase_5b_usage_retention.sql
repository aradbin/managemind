-- The daily rollup folds usage older than 13 months into one row per month
-- (phase-5b-plan §3.6), which removes the month's other daily rows.
GRANT DELETE ON platform.usage_daily TO app_rw;
