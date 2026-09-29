/**
 * Minimal Markdown → HTML for our own bundled docs (licenses). Supports headings,
 * paragraphs, `-` lists, pipe tables, `code`, **bold** and bare URLs. Input is escaped first.
 */
import { esc } from './dom';

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\((https?:\/\/[^)\s]+)\)/g, '(<span class="md-url">$1</span>)');
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    if (table.length) {
      const [head, ...rows] = table;
      out.push(
        `<div class="md-table"><table><thead><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
    }
    para = [];
    list = [];
    table = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hm) {
      flush();
      const level = Math.min(4, hm[1]!.length + 1);
      out.push(`<h${level}>${inline(hm[2]!)}</h${level}>`);
    } else if (/^\s*\|/.test(line)) {
      if (para.length || list.length) {
        const keep = table;
        table = [];
        flush();
        table = keep;
      }
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // separator row
      table.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (para.length || table.length) flush();
      list.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (!line.trim()) {
      flush();
    } else {
      if (list.length || table.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}
