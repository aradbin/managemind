import { createFileRoute } from '@tanstack/react-router';
import { StorePagesPage } from '../../../../pages/store-pages';

export const Route = createFileRoute('/_shell/online-store/pages/')({ component: StorePagesPage });
