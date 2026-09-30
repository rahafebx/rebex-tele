// Telegram HTML is deliberately stricter than normal browser HTML.
// This helper converts the small set of editor tags we generate into Telegram-safe HTML.
export function editorHtmlToTelegramHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const allowed = new Set([
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "STRIKE",
    "DEL",
    "CODE",
    "PRE",
    "A",
    "BLOCKQUOTE",
    "SPAN",
    "BR",
    "TG-SPOILER",
  ]);
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    if (!allowed.has(el.tagName))
      return Array.from(el.childNodes).map(walk).join("");

    const content = Array.from(el.childNodes).map(walk).join("");
    switch (el.tagName) {
      case "B":
      case "STRONG":
        return `<b>${content}</b>`;
      case "I":
      case "EM":
        return `<i>${content}</i>`;
      case "U":
        return `<u>${content}</u>`;
      case "S":
      case "STRIKE":
      case "DEL":
        return `<s>${content}</s>`;
      case "CODE":
        return `<code>${content}</code>`;
      case "PRE":
        return `<pre>${content}</pre>`;
      case "BLOCKQUOTE":
        return `<blockquote>${content}</blockquote>`;
      case "A": {
        const href = el.getAttribute("href") ?? "";
        try {
          const url = new URL(href);
          if (!["http:", "https:", "tg:"].includes(url.protocol))
            return content;
          return `<a href="${url.toString().replaceAll('"', "&quot;")}">${content}</a>`;
        } catch {
          return content;
        }
      }
      case "SPAN":
        if (el.classList.contains("spoiler"))
          return `<tg-spoiler>${content}</tg-spoiler>`;
        return content;
      case "TG-SPOILER":
        return `<tg-spoiler>${content}</tg-spoiler>`;
      case "BR":
        return "\n";
      default:
        return content;
    }
  };
  return Array.from(doc.body.childNodes).map(walk).join("");
}

// Telegram "Rich Messages" (sendRichMessage) accept a broader HTML tag set
// than classic parse_mode:"HTML" — headings, tables, footers, dividers,
// lists, details, etc. This converts the editor source into that rich-HTML
// form; any message that contains a rich-only block is sent via sendRichMessage.

const RICH_MARKERS = [
  "<h1",
  "<h2",
  "<h3",
  "<h4",
  "<h5",
  "<h6",
  "<table",
  "<caption",
  "<summary",
  "<details",
  "<footer",
  "<aside",
  "<mark",
  "<hr",
  "<ol",
  "<ul",
];

export function isRichHtml(html: string): boolean {
  return RICH_MARKERS.some((m) => html.includes(m));
}

const RICH_INLINE = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "INS",
  "S",
  "STRIKE",
  "DEL",
  "CODE",
  "MARK",
  "SUB",
  "SUP",
  "A",
  "BR",
  "TG-SPOILER",
]);

const RICH_BLOCK_CHILD = new Set([
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "TABLE",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "ASIDE",
  "PRE",
  "DETAILS",
  "FOOTER",
]);

export function editorHtmlToRichHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const escapeText = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  const escapeAttr = (s: string) => escapeText(s).replaceAll('"', "&quot;");

  const tableAttrs = (el: HTMLElement) => {
    let out = "";
    for (const name of ["colspan", "rowspan", "align", "valign"]) {
      const value = el.getAttribute(name);
      if (value) out += ` ${name}="${escapeAttr(value)}"`;
    }
    return out;
  };

  const walk = (node: Node, inlineOnly = false): string => {
    if (node.nodeType === Node.TEXT_NODE)
      return escapeText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (RICH_INLINE.has(tag) || (tag === "SPAN" && el.classList.contains("spoiler"))) {
      const content = Array.from(el.childNodes)
        .map((c) => walk(c, true))
        .join("");
      switch (tag) {
        case "BR":
          return "\n";
        case "A": {
          const href = el.getAttribute("href") ?? "";
          try {
            const url = new URL(href);
            if (!["http:", "https:", "tg:"].includes(url.protocol))
              return content;
            return `<a href="${url.toString().replaceAll('"', "&quot;")}">${content}</a>`;
          } catch {
            return content;
          }
        }
        case "SPAN":
        case "TG-SPOILER":
          return `<tg-spoiler>${content}</tg-spoiler>`;
        default:
          return `<${tag.toLowerCase()}>${content}</${tag.toLowerCase()}>`;
      }
    }

    const content = Array.from(el.childNodes)
      .map((c) => walk(c, inlineOnly))
      .join("");

    switch (tag) {
      case "DIV":
      case "P":
        if (inlineOnly) return content;
        if (
          Array.from(el.children).some((c) =>
            RICH_BLOCK_CHILD.has((c as HTMLElement).tagName),
          )
        )
          return content;
        return content.trim() ? `<p>${content}</p>` : "";
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const inner = Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("");
        return inner.trim() ? `<${tag.toLowerCase()}>${inner}</${tag.toLowerCase()}>` : "";
      }
      case "PRE":
        return `<pre>${content}</pre>`;
      case "BLOCKQUOTE":
        return content.trim() ? `<blockquote>${content}</blockquote>` : "";
      case "ASIDE":
        return content.trim() ? `<aside>${content}</aside>` : "";
      case "UL":
        return content.trim() ? `<ul>${content}</ul>` : "";
      case "OL":
        return content.trim() ? `<ol>${content}</ol>` : "";
      case "LI":
        return content.trim() ? `<li>${content}</li>` : "";
      case "TABLE":
        return content.trim() ? `<table>${content}</table>` : "";
      case "CAPTION": {
        const inner = Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("");
        return inner.trim() ? `<caption>${inner}</caption>` : "";
      }
      case "THEAD":
      case "TBODY":
      case "TFOOT":
        return content;
      case "TR":
        return content.trim() ? `<tr>${content}</tr>` : "";
      case "TH":
        return `<th${tableAttrs(el)}>${Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("")}</th>`;
      case "TD":
        return `<td${tableAttrs(el)}>${Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("")}</td>`;
      case "DETAILS":
        return content.trim()
          ? `<details${el.hasAttribute("open") ? " open" : ""}>${content}</details>`
          : "";
      case "SUMMARY": {
        const inner = Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("");
        return inner.trim() ? `<summary>${inner}</summary>` : "";
      }
      case "FOOTER": {
        const inner = Array.from(el.childNodes)
          .map((c) => walk(c, true))
          .join("");
        return inner.trim() ? `<footer>${inner}</footer>` : "";
      }
      case "HR":
        return "<hr/>";
      default:
        return Array.from(el.childNodes)
          .map((c) => walk(c, inlineOnly))
          .join("");
    }
  };

  const out: string[] = [];
  let textRun = "";
  const flush = () => {
    const t = textRun.trim();
    textRun = "";
    if (t) out.push(`<p>${t}</p>`);
  };
  for (const child of doc.body.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) textRun += walk(child);
    else {
      flush();
      out.push(walk(child));
    }
  }
  flush();
  return out.join("");
}

// Shared save-time decision used by the send composer, schedules manager, and
// commands manager: a message containing rich-only blocks is stored in the
// rich-HTML form (and sent via sendRichMessage); everything else uses the
// classic Telegram-safe HTML form. Returns both the payload and the flag so
// callers can persist is_rich alongside the response.
export function telegramSavePayload(html: string): {
  response: string;
  isRich: boolean;
} {
  const richHtml = editorHtmlToRichHtml(html);
  const isRich = isRichHtml(richHtml);
  return {
    response: (isRich ? richHtml : editorHtmlToTelegramHtml(html)).trim(),
    isRich,
  };
}
