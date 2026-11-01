// Short confirmations ("Saved.") announced politely to screen readers and
// gone after a few seconds, bottom right (above the tab bar on phones).
// Errors stay inline next to what failed instead.
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
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
      >
        {toasts.map((x) => (
          <p
            key={x.id}
            className="rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium shadow-lg"
          >
            {x.message}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
