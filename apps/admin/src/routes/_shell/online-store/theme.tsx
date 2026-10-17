// The page lives in src/pages so the router's code splitting moves all of
// it, the shared theme schemas included, out of the first download.
import { createFileRoute } from '@tanstack/react-router';
import { ThemePage } from '../../../pages/theme';

export const Route = createFileRoute('/_shell/online-store/theme')({ component: ThemePage });
