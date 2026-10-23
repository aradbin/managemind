import { createFileRoute } from '@tanstack/react-router';
import { TemplatesPage } from '../../../pages/templates';

export const Route = createFileRoute('/_shell/settings/templates')({
  component: TemplatesPage,
});
