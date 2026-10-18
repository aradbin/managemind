import { createFileRoute } from '@tanstack/react-router';
import { ReturnDetailPage } from '../../../pages/return-detail';

export const Route = createFileRoute('/_shell/returns/$id')({ component: ReturnDetailPage });
