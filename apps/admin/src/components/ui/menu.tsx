// The look of dropdown menus on Radix (shadcn/ui, ADR 0033): a bordered
// popover with 8 px corners and compact items.
export const menuContent =
  'z-50 min-w-56 rounded-lg border border-border bg-background p-1 text-foreground shadow-md';
export const menuItem =
  'relative flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 md:min-h-8';
export const menuSeparator = '-mx-1 my-1 h-px bg-border';
