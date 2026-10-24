-- Hand-written (ADR 0009, phase-5b-plan §4): grants and triggers for the
-- Phase 5B platform tables. Platform tables have no RLS, so these grants are
-- the access control; platform.test.ts pins them. Export, purge and reset run
-- in GitHub Actions as the migration role (§3.9), so the app role gets no
-- DELETE here.

GRANT UPDATE (kind, entitlements, status_reason, closed_at, purge_after) ON platform.tenants TO app_rw;
--> statement-breakpoint

-- Plans and subscriptions: super admins edit them through the platform API.
GRANT SELECT, INSERT ON platform.plans, platform.subscriptions TO app_rw;
--> statement-breakpoint
GRANT UPDATE (name, monthly_price, setup_fee, overage_prices, entitlements, offered)
  ON platform.plans TO app_rw;
--> statement-breakpoint
GRANT UPDATE (plan_id, price_override, setup_fee_override, entitlement_override, billing_day,
  trial_ends_on, status, hold_until, hold_reason) ON platform.subscriptions TO app_rw;
--> statement-breakpoint

-- The daily rollup overwrites a day's value; health is rewritten as a whole.
GRANT SELECT, INSERT ON platform.usage_daily, platform.store_health TO app_rw;
--> statement-breakpoint
GRANT UPDATE (value) ON platform.usage_daily TO app_rw;
--> statement-breakpoint
GRANT UPDATE (checked_at, payments, email, sms, domains, activity, checklist)
  ON platform.store_health TO app_rw;
--> statement-breakpoint

-- Our invoice details and VAT (Q8).
GRANT SELECT, INSERT ON platform.settings TO app_rw;
--> statement-breakpoint
GRANT UPDATE (value) ON platform.settings TO app_rw;
--> statement-breakpoint

-- Invoices change only as their machine allows (the triggers below); lines
-- change only on drafts; payments and reminders are append-only.
GRANT SELECT, INSERT ON platform.invoices TO app_rw;
--> statement-breakpoint
GRANT UPDATE (number, status, issue_after, issued_on, due_on, paid_at, voided_at, void_reason,
  subtotal, vat, total, amount_paid, issuer, billed_to, vat_rate_bp) ON platform.invoices TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON platform.invoice_lines TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON platform.billing_payments, platform.reminders TO app_rw;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE platform.invoice_number_seq TO app_rw;
--> statement-breakpoint

-- Terms: versions are published, acceptances appended; neither changes.
GRANT SELECT, INSERT ON platform.terms_versions, platform.terms_acceptances TO app_rw;
--> statement-breakpoint

-- Jobs are asked for by the platform API and run by tenant-jobs.yml; the
-- purge's approval is the API's to record.
GRANT SELECT, INSERT ON platform.tenant_jobs, platform.tenant_purges TO app_rw;
--> statement-breakpoint
GRANT UPDATE (approved_by, approved_at) ON platform.tenant_purges TO app_rw;
--> statement-breakpoint

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON platform.plans
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON platform.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER usage_daily_set_updated_at BEFORE UPDATE ON platform.usage_daily
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER store_health_set_updated_at BEFORE UPDATE ON platform.store_health
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON platform.settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON platform.invoices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenant_jobs_set_updated_at BEFORE UPDATE ON platform.tenant_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenant_purges_set_updated_at BEFORE UPDATE ON platform.tenant_purges
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- An invoice follows draft -> issued -> paid, either to void. Once issued,
-- its number, dates, totals and snapshots never change (Stripe's finalized
-- invoice); only payment and voiding move it on.
CREATE FUNCTION app.invoices_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status IN ('issued', 'void'))
    OR (OLD.status = 'issued' AND NEW.status IN ('paid', 'void'))
  ) THEN
    RAISE EXCEPTION 'invoice % cannot go from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.number IS DISTINCT FROM OLD.number OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
    OR NEW.due_on IS DISTINCT FROM OLD.due_on OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.vat IS DISTINCT FROM OLD.vat OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.issuer IS DISTINCT FROM OLD.issuer OR NEW.billed_to IS DISTINCT FROM OLD.billed_to
    OR NEW.vat_rate_bp IS DISTINCT FROM OLD.vat_rate_bp
  ) THEN
    RAISE EXCEPTION 'issued invoice % cannot change', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('paid', 'void') AND NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
    RAISE EXCEPTION 'closed invoice % takes no payments', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE ON platform.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_guard();
--> statement-breakpoint

CREATE FUNCTION app.invoice_lines_draft_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM platform.invoices
   WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF s IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'lines of a % invoice cannot change', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON platform.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION app.invoice_lines_draft_only();
--> statement-breakpoint

-- A payment is recorded against an issued invoice only.
CREATE FUNCTION app.billing_payments_issued_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM platform.invoices WHERE id = NEW.invoice_id;
  IF s IS DISTINCT FROM 'issued' THEN
    RAISE EXCEPTION 'a % invoice takes no payment', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER billing_payments_issued_only BEFORE INSERT ON platform.billing_payments
  FOR EACH ROW EXECUTE FUNCTION app.billing_payments_issued_only();
