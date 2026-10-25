/* Line icons from the approved prototype (24px grid, 1.75 stroke). */

export const ICONS = {
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15a2.5 2.5 0 0 1-2-2.5z"/>',
  board:
    '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9.5 8v8M14.5 8v4.5"/>',
  flag: '<path d="M5.5 20.5V4.5m0 0h12l-2.5 4 2.5 4h-12"/>',
  team: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="10" r="2.3"/><path d="M16 14.2a4.5 4.5 0 0 1 4.5 4.3"/>',
  gear: '<path d="M10.3 4h3.4l.5 2.1 1.6.7 1.9-1.1 2.4 2.4-1.1 1.9.7 1.6 2.1.5v3.4l-2.1.5-.7 1.6 1.1 1.9-2.4 2.4-1.9-1.1-1.6.7-.5 2.1h-3.4l-.5-2.1-1.6-.7-1.9 1.1-2.4-2.4 1.1-1.9-.7-1.6L2 13.7v-3.4l2.1-.5.7-1.6-1.1-1.9 2.4-2.4 1.9 1.1 1.6-.7z"/><circle cx="12" cy="12" r="3"/>',
  hash: '<path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="m20 20-4.2-4.2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>',
  clip: '<path d="m18.5 11.5-6.7 6.7a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-3.5-6.5L4 10.5z"/>',
  phone:
    '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15 15 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
  video:
    '<rect x="3.5" y="6.5" width="12" height="11" rx="2.5"/><path d="m15.5 11 5-3v8l-5-3"/>',
  videoOff:
    '<rect x="3.5" y="6.5" width="12" height="11" rx="2.5"/><path d="m15.5 11 5-3v8l-5-3M4 4l16 16"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  micOff:
    '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M4 4l16 16"/>',
  screen:
    '<rect x="3.5" y="5" width="17" height="11.5" rx="2.5"/><path d="M9 20h6M12 16.5V20"/>',
  smile:
    '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5"/>',
  reply: '<path d="M10 7 5 12l5 5"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/>',
  edit: '<path d="m5 19 1-4L16.5 4.5a2 2 0 0 1 3 3L9 18z"/>',
  trash: '<path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7M10 11v5M14 11v5"/>',
  file: '<path d="M7 3.5h6.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM13.5 3.5V8H18"/>',
  dl: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 19.5h14"/>',
  ul: '<path d="M12 16V5M7.5 9 12 4.5 16.5 9M5 19.5h14"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  shield: '<path d="M12 3.5 5 6.5v5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9v-5z"/>',
  shieldOk:
    '<path d="M12 3.5 5 6.5v5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9v-5z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  laptop:
    '<rect x="5" y="6" width="14" height="9.5" rx="2"/><path d="M3 19h18"/>',
  phoneDev:
    '<rect x="7.5" y="3.5" width="9" height="17" rx="2.5"/><path d="M11 17.5h2"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  at: '<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  rot: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  alert: '<path d="M12 4 3.5 19h17z"/><path d="M12 10v4M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  out: '<path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M18 12H9"/>',
  layers:
    '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 13 8.5 4.5 8.5-4.5"/>',
  pBaixa: '<path d="m7 10 5 5 5-5"/>',
  pNormal: '<path d="M7 12h10"/>',
  pAlta: '<path d="m7 11 5-5 5 5M7 17l5-5 5 5"/>',
  pUrgente: '<path d="M12 5v9M12 18.5h.01" stroke-width="2.6"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 8 8 5.5L20 8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  cmd: '<path d="M8 8V6a2 2 0 1 0-2 2h12a2 2 0 1 0-2-2v12a2 2 0 1 0 2-2H6a2 2 0 1 0 2 2z"/>',
  pin: '<path d="M12 21v-6M8 4h8l-1 6 3 3H6l3-3z"/>',
} as const;

export type IconName = keyof typeof ICONS;
