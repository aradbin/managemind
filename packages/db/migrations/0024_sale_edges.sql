-- Hand-written (phase-4-plan §3.14): the daily catch-up for scheduled sales.
-- Each sale's window edges are queued as delayed messages when it is saved;
-- this lists, across stores, the products whose window opened or closed in
-- the last hours, in case a message was lost. A SECURITY DEFINER function
-- owned by mm_system, like the drift check (migration 0012): mm_system may
-- read only the sale columns' rows, and only here.
GRANT SELECT ON store.variants TO mm_system;
--> statement-breakpoint
CREATE POLICY system_sale_edges ON store.variants FOR SELECT TO mm_system USING (sale_price IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION app.sale_edges(hours integer DEFAULT 25, max_rows integer DEFAULT 5000)
  RETURNS TABLE (tenant_id uuid, product_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT v.tenant_id, v.product_id
    FROM store.variants v
   WHERE v.sale_price IS NOT NULL AND v.archived_at IS NULL
     AND ((v.sale_starts_at BETWEEN now() - make_interval(hours => hours) AND now())
       OR (v.sale_ends_at BETWEEN now() - make_interval(hours => hours) AND now()))
   LIMIT least(max_rows, 20000)
$$;
--> statement-breakpoint
ALTER FUNCTION app.sale_edges(integer, integer) OWNER TO mm_system;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.sale_edges(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.sale_edges(integer, integer) TO app_rw;
