// Short confirmations ("Saved.") announced politely to screen readers and
// gone after a few seconds, bottom right (above the tab bar on phones), as
// the canvas's toast: 356 px, a check, 13 px words. Errors stay inline next
// to what failed instead.
import { CircleCheck } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const show = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, message }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 md:inset-x-auto md:right-6 md:bottom-6 md:w-[356px] md:max-w-[calc(100%-3rem)]"
      >
        {toasts.map((x) => (
          <p
            key={x.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-popover px-4 py-3.5 text-[13px] leading-5 text-foreground shadow-[0_4px_12px_rgb(0_0_0/0.1)] md:py-4"
          >
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            <span className="font-medium">{x.message}</span>
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
