// Row actions show on hover, keyboard focus, or while their confirmation popover is open — and always on a touch
// screen, which has no hover.
export const SHOW_ON_HOVER =
  'hidden group-hover:flex group-focus-within:flex group-has-[[aria-expanded=true]]:flex [@media(hover:none)]:flex';
export const HIDE_ON_HOVER =
  'group-hover:hidden group-focus-within:hidden group-has-[[aria-expanded=true]]:hidden [@media(hover:none)]:hidden';
