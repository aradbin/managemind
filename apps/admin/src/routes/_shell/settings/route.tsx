// Every settings page sits in the frame the canvas draws (ADR 0034): the
// list of settings pages beside a 780 px column. The Settings page itself is
// its own grid of cards, without the frame.
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { SettingsFrame } from '../../../components/settings-frame';

export const Route = createFileRoute('/_shell/settings')({ component: Layout });

function Layout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path === '/settings' || path === '/settings/') return <Outlet />;
  return (
    <SettingsFrame>
      <Outlet />
    </SettingsFrame>
  );
}
