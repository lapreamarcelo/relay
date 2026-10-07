let locks = 0;
let restore: (() => void) | null = null;

export function lockPageScroll(): () => void {
  if (locks++ === 0) {
    const html = document.documentElement;
    const body = document.body;
    const htmlOverflow = html.style.overflow;
    const bodyOverflow = body.style.overflow;
    const paddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    const currentPadding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    restore = () => { html.style.overflow = htmlOverflow; body.style.overflow = bodyOverflow; body.style.paddingRight = paddingRight; };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) { restore?.(); restore = null; }
  };
}
