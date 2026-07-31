export const navigationScript = String.raw`'use strict';
(() => {
  const script = document.currentScript;
  const home = script && script.dataset ? script.dataset.systemManagerHome : '';
  if (!home || document.querySelector('[data-system-manager-nav]')) return;
  const link = document.createElement('a');
  link.className = 'system-manager-home-link';
  link.dataset.systemManagerNav = 'true';
  link.href = home;
  link.setAttribute('aria-label', '返回系统管家首页');
  link.textContent = '← 返回系统管家';
  const openInCurrentView = (event) => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    window.location.assign(link.href);
  };
  link.addEventListener('click', openInCurrentView);
  link.addEventListener('auxclick', openInCurrentView);
  document.body.appendChild(link);
})();
`

export const navigationStyle = String.raw`.system-manager-home-link {
  position: fixed;
  z-index: 2147483000;
  top: max(10px, env(safe-area-inset-top));
  left: max(10px, env(safe-area-inset-left));
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(118, 128, 124, .45);
  border-radius: 999px;
  color: #17223b;
  background: rgba(250, 249, 244, .94);
  box-shadow: 0 5px 20px rgba(20, 31, 43, .14);
  font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
  text-decoration: none;
  backdrop-filter: blur(10px);
}
.system-manager-home-link:hover { transform: translateY(-1px); }
.system-manager-home-link:focus-visible { outline: 3px solid #d2a928; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .system-manager-home-link { color: #f5f3eb; background: rgba(24, 31, 40, .94); border-color: rgba(226, 230, 227, .35); }
}
@media (prefers-reduced-motion: reduce) { .system-manager-home-link:hover { transform: none; } }
`
