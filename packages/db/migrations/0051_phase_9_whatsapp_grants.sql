-- Hand-written (ADR 0009, phase-9-plan §4): FORCE ROW LEVEL SECURITY, grants
-- and updated_at triggers for stage 2's WhatsApp tables.

ALTER TABLE store.whatsapp_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE store.whatsapp_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Templates are written when the store connects WhatsApp and as Meta reviews
-- them; contacts as shoppers write, opt out, and are anonymized.
GRANT SELECT, INSERT, UPDATE, DELETE ON store.whatsapp_templates TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON store.whatsapp_contacts TO app_rw;
--> statement-breakpoint

CREATE TRIGGER whatsapp_templates_set_updated_at BEFORE UPDATE ON store.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER whatsapp_contacts_set_updated_at BEFORE UPDATE ON store.whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
