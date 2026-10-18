import { createFileRoute } from '@tanstack/react-router';
import { MessageLogPage } from '../../../pages/message-log';

export const Route = createFileRoute('/_shell/settings/messages')({
  component: () => <MessageLogPage />,
});
