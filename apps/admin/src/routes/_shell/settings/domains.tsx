import { createFileRoute } from '@tanstack/react-router';
import { DomainsPage } from '../../../pages/domains';

export const Route = createFileRoute('/_shell/settings/domains')({ component: DomainsPage });
