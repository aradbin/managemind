import { createFileRoute } from '@tanstack/react-router';
import { OnlineStorePage } from '../../../pages/online-store';

export const Route = createFileRoute('/_shell/online-store/')({ component: OnlineStorePage });
