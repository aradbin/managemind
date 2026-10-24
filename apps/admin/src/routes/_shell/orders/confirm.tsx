import { createFileRoute } from '@tanstack/react-router';
import { defined, searchOneOf } from '../../../lib/search';
import { ConfirmQueuePage } from '../../../pages/confirm-queue';

export const Route = createFileRoute('/_shell/orders/confirm')({
  validateSearch: (search: Record<string, unknown>) =>
    defined({ tab: searchOneOf(search.tab, ['later', 'unreachable', 'risky'] as const) }),
  component: ConfirmQueuePage,
});
