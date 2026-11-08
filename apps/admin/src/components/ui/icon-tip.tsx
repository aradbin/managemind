// An icon button's name in shadcn/ui's tooltip (components/ui/button.tsx).
// Its own chunk, loaded with the first icon button, so Radix Tooltip stays
// out of the sign-in JavaScript (ADR 0033's budget).
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './shadcn/tooltip';

export default function IconTip({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent sideOffset={6}>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
