import { svg24 } from './lib.mjs';
const p = (d) => `<path d="${d}"/>`;
const c = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const U = {};

U.menu = svg24(p('M4 6H20M4 12H20M4 18H20'));
U.close = svg24(p('M6 6L18 18M18 6L6 18'));
// gear: 8 teeth
const gear = (() => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2;
    for (const [da, R] of [[-0.2, 7.6], [-0.12, 10], [0.12, 10], [0.2, 7.6]]) {
      const a = a0 + da * 1.35;
      pts.push(`${(12 + R * Math.cos(a)).toFixed(2)} ${(12 + R * Math.sin(a)).toFixed(2)}`);
    }
  }
  return 'M' + pts.join('L') + 'Z';
})();
U.settings = svg24(p(gear) + c(12, 12, 3));
U['sound-on'] = svg24(p('M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4Z') + p('M15.5 9Q17.5 12 15.5 15') + p('M18.5 6.5Q22 12 18.5 17.5'));
U['sound-off'] = svg24(p('M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4Z') + p('M16 9.5L21 14.5M21 9.5L16 14.5'));
U.vibrate = svg24(`<rect x="8" y="3.5" width="8" height="17" rx="2.2"/>` + p('M11 17.5H13') + p('M4 8.5V15.5M20 8.5V15.5M1.5 10.5V13.5M22.5 10.5V13.5'));
U.help = svg24(c(12, 12, 9.5) + p('M9.2 9.5Q9.4 6.8 12 6.8Q14.8 6.8 14.8 9.4Q14.8 11 12.8 12Q12 12.5 12 13.8') + p('M12 17.2V17.3'));
U.play = svg24(p('M8 5.5L18.5 12L8 18.5Z'));
U.restart = svg24(p('M4.5 12A7.5 7.5 0 1 0 7 6.4') + p('M4.5 4V8.5H9'));
U.home = svg24(p('M3.5 11L12 4L20.5 11') + p('M6 9.5V19.5H10V14H14V19.5H18V9.5'));
U['chevron-left'] = svg24(p('M15 5L8 12L15 19'));
U['chevron-right'] = svg24(p('M9 5L16 12L9 19'));
U.check = svg24(p('M5 12.5L10 17.5L19 7'));
U.cpu = svg24(`<rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/>` + `<rect x="10" y="10" width="4" height="4" rx="1"/>` + p('M9.5 3V6.5M14.5 3V6.5M9.5 17.5V21M14.5 17.5V21M3 9.5H6.5M3 14.5H6.5M17.5 9.5H21M17.5 14.5H21'));
U.human = svg24(c(12, 8, 3.8) + p('M4.5 20Q4.5 13.5 12 13.5Q19.5 13.5 19.5 20'));
U.rotate = svg24(p('M20 6V10.5H15.5') + p('M4 18V13.5H8.5') + p('M19 10.5A7.5 7.5 0 0 0 6 7.5') + p('M5 13.5A7.5 7.5 0 0 0 18 16.5'));
U.plus = svg24(p('M12 5V19M5 12H19'));
U.minus = svg24(p('M5 12H19'));
U.trophy = svg24(p('M7.5 4H16.5V10Q16.5 14.5 12 14.5Q7.5 14.5 7.5 10Z') + p('M7.5 6H4.5V8Q4.5 11 7.8 11.5M16.5 6H19.5V8Q19.5 11 16.2 11.5') + p('M12 14.5V18M8 20H16M9 18H15'));
U.timer = svg24(c(12, 13.5, 7.5) + p('M12 13.5V9.5') + p('M9.5 3H14.5') + p('M18.5 6.5L19.8 5.2'));
U.save = svg24(p('M5 4H16.5L20 7.5V18Q20 20 18 20H6Q4 20 4 18V6Q4 4 6 4') + p('M8 4V8.5H15V4') + p('M7.5 20V14H16.5V20'));

export default U;
