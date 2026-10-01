import type { ReactNode } from "react";

type Block =
  | { type: "h"; level: number; text: string; id: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "hr" }
  | { type: "table"; header: string[]; rows: string[][] };

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <article className="prose">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </article>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "h") {
    const Tag = (`h${block.level}` as "h1" | "h2" | "h3" | "h4");
    return <Tag id={block.id}>{inline(block.text)}</Tag>;
  }
  if (block.type === "p") return <p>{inline(block.text)}</p>;
  if (block.type === "ul")
    return (
      <ul>
        {block.items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ul>
    );
  if (block.type === "ol")
    return (
      <ol>
        {block.items.map((item, index) => (
          <li key={index}>{inline(item)}</li>
        ))}
      </ol>
    );
  if (block.type === "quote") return <blockquote>{inline(block.text)}</blockquote>;
  if (block.type === "code") return <pre><code>{block.text}</code></pre>;
  if (block.type === "hr") return <hr />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {block.header.map((cell) => (
              <th key={cell}>{inline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({ type: "h", level: heading[1].length, text, id: slug(text) });
      i += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        body.push(lines[i].slice(2));
        i += 1;
      }
      blocks.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? ""));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
      if (link) {
        const href = link[2];
        const safe = href.startsWith("#") || href.startsWith("https://") || href.startsWith("http://");
        nodes.push(
          safe ? (
            <a key={key} href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
              {link[1]}
            </a>
          ) : (
            <span key={key}>{link[1]}</span>
          ),
        );
      }
    }
    key += 1;
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
