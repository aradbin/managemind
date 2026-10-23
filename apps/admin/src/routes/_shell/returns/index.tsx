import { createFileRoute } from '@tanstack/react-router';
import { ReturnsPage } from '../../../pages/returns';

export const Route = createFileRoute('/_shell/returns/')({ component: ReturnsPage });
