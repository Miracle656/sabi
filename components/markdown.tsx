// Tiny, dependency-free markdown for typical Claude output: headings,
// paragraphs, fenced code, nested bullet/numbered lists, pipe tables, inline
// code, bold, links. Renders React nodes (no innerHTML).

import { Fragment, type ReactNode } from "react";

export function Markdown({ text }: { text: string }) {
  return <div className="prose-sabi">{renderBlocks(text)}</div>;
}

/** An inline provenance chip: this clause came from that memory. */
function Cite({ id }: { id: string }) {
  return (
    <span
      className="mono ml-0.5 inline-flex items-center gap-1.5 rounded-full border border-line2 px-2 py-px align-[1px] text-[11.5px] text-muted"
      title={`Recalled from memory ${id}`}
    >
      <span className="h-[5px] w-[5px] rounded-full bg-ok" />
      {id}
    </span>
  );
}

const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(
        <p key={key++} className="mt-2 font-medium">
          {renderInline(heading[1])}
        </p>,
      );
      i++;
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        if (!TABLE_SEP.test(lines[i])) {
          rows.push(
            lines[i]
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((c) => c.trim()),
          );
        }
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={key++} className="overflow-x-auto">
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((c, n) => (
                    <th key={n}>
                      {renderInline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((r, rn) => (
                <tr key={rn}>
                  {r.map((c, n) => (
                    <td key={n}>
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const { node, next } = parseList(lines, i, indentOf(line), key++);
      out.push(node);
      i = next;
      continue;
    }

    // Paragraph: consecutive plain lines.
    const buf: string[] = [];
    while (i < lines.length && isPlain(lines[i])) buf.push(lines[i++].trim());
    out.push(<p key={key++}>{renderInline(buf.join(" "))}</p>);
  }
  return out;
}

function isPlain(l: string): boolean {
  return (
    l.trim() !== "" &&
    !l.trim().startsWith("```") &&
    !HEADING.test(l) &&
    !BULLET.test(l) &&
    !NUMBERED.test(l) &&
    !TABLE_ROW.test(l)
  );
}

function indentOf(l: string): number {
  return (BULLET.exec(l) ?? NUMBERED.exec(l))?.[1].length ?? 0;
}

/**
 * Parse one list (bullet or numbered) starting at `i` with the given indent.
 * Deeper-indented items become nested lists inside the previous item.
 * Returns the node and the index of the first line after the list.
 */
function parseList(
  lines: string[],
  i: number,
  indent: number,
  key: number,
): { node: ReactNode; next: number } {
  const ordered = NUMBERED.test(lines[i]);
  const start = ordered ? Number(NUMBERED.exec(lines[i])![2]) : 1;
  const items: ReactNode[][] = [];

  while (i < lines.length) {
    const l = lines[i];
    const m = ordered ? NUMBERED.exec(l) : BULLET.exec(l);
    const other = ordered ? BULLET.exec(l) : NUMBERED.exec(l);
    const ind = indentOf(l);

    if ((m || other) && ind > indent && items.length) {
      // nested list under the previous item
      const sub = parseList(lines, i, ind, key * 31 + items.length);
      items[items.length - 1].push(sub.node);
      i = sub.next;
      continue;
    }
    if (m && ind === indent) {
      const text = ordered ? m[3] : m[2];
      items.push([<Fragment key="t">{renderInline(text)}</Fragment>]);
      i++;
      continue;
    }
    if (l.trim() !== "" && ind > indent && !m && !other && items.length) {
      // continuation line of the previous item
      items[items.length - 1].push(<Fragment key={`c${i}`}> {renderInline(l.trim())}</Fragment>);
      i++;
      continue;
    }
    break;
  }

  const children = items.map((it, n) => <li key={n}>{it}</li>);
  const node = ordered ? (
    <ol key={key} start={start}>
      {children}
    </ol>
  ) : (
    <ul key={key}>{children}</ul>
  );
  return { node, next: i };
}

// The Sabi prompt instructs the model to cite as "(mem: <memory_id>)". Render
// those inline, on the clause they sit after, rather than as raw parentheses.
const CITE = /\(mem:\s*([A-Za-z0-9_\-…]{3,120})\)/;
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\(mem:\s*[A-Za-z0-9_\-…]{3,120}\))/g;

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE);
  return parts.map((p, n) => {
    if (!p) return null;
    const cite = CITE.exec(p);
    if (cite) return <Cite key={n} id={cite[1]} />;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={n}>{p.slice(1, -1)}</code>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={n}>{p.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link && /^https?:\/\//.test(link[2]))
      return (
        <a key={n} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    return <Fragment key={n}>{p}</Fragment>;
  });
}
