import { createFileRoute } from '@tanstack/react-router';
import { NewPromotionPage } from '../../../pages/promotion-editor';

export const Route = createFileRoute('/_shell/promotions/new')({ component: NewPromotionPage });
