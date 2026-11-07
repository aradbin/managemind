// The look of dropdown menus and popovers on Radix (shadcn/ui, ADR 0033 and
// 0034): the canvas's .mm-menu, a bordered popover with 8 px corners, items
// with a 16 px muted icon, 40 px rows on phones.
export const menuContent =
  'z-50 min-w-[200px] rounded-lg border border-border bg-popover p-1 text-foreground shadow-md';
export const menuItem =
  "relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-sm leading-5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 md:min-h-0 md:py-1.5 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
/** A destructive item: red words and icon. */
export const menuItemDanger =
  'text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger [&_svg]:!text-danger';
export const menuSeparator = '-mx-1 my-1 h-px bg-border';
export const menuLabel = 'px-2 py-1.5 text-xs leading-4 font-medium text-muted-foreground';
