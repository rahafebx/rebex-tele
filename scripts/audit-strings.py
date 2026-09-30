"""Audit authored source for characters that leaked in from the wrong script.

Arabic strings in this repo are hand-typed, and a stray CJK codepoint, a
mangled combining sequence, or a U+FFFD REPLACEMENT CHARACTER can slip in
without looking wrong in a terminal. This flags every non-ASCII character
outside the Arabic and Latin blocks (plus the format marks and general
punctuation those scripts legitimately use), so a bad byte is caught while the
string is being written rather than in review.

It is deliberately permissive about Arabic and Latin punctuation -- guillemets,
the Arabic comma and question mark, and the arrows are all in active use across
the existing components and are not findings.

Usage:  python3 scripts/audit-strings.py [paths...]
Exit code 1 if anything suspicious is found.
"""

import io
import os
import re
import sys

# Inclusive codepoint ranges considered legitimate for this codebase.
ALLOWED_RANGES = [
    (0x0020, 0x007E),  # printable ASCII
    (0x00A0, 0x00FF),  # Latin-1 supplement: « » × ÷ etc.
    (0x0100, 0x024F),  # Latin Extended-A/B
    (0x0600, 0x06FF),  # Arabic
    (0x0750, 0x077F),  # Arabic Supplement
    (0x08A0, 0x08FF),  # Arabic Extended-A
    (0x200C, 0x200F),  # ZWNJ, ZWJ, LRM, RLM
    (0x2010, 0x201F),  # dashes and quotation marks
    (0x2026, 0x2027),  # ellipsis
    (0x2030, 0x205E),  # per-mille, primes, general punctuation
    (0x2190, 0x21FF),  # arrows
    (0x2200, 0x22FF),  # math operators used in prose
    (0xFB50, 0xFDFF),  # Arabic Presentation Forms-A
    (0xFE70, 0xFEFF),  # Arabic Presentation Forms-B
    (0x1E00, 0x1EFF),  # Latin Extended Additional (Vietnamese)
    (0x2460, 0x24FF),  # circled digits
    (0x2500, 0x257F),  # box drawing (the PRD's textual diagrams)
    (0x2580, 0x259F),  # block elements
    (0x25A0, 0x25FF),  # geometric shapes
    (0x2600, 0x27BF),  # misc symbols + dingbats (✅ ❌ in the PRD tables)
    (0x2B00, 0x2BFF),  # arrows / squares
]

TEXT_SUFFIXES = (".ts", ".tsx", ".css", ".md", ".mjs", ".json", ".txt")
SKIP_DIRS = {"node_modules", ".next", ".git", ".opencode"}

# A Latin word sitting inside an Arabic-dominant string is almost always an
# authoring accident ("معLearning من الرسائل"), not an intentional technical
# term. The allowlist below is the deliberate exceptions: API method names,
# env vars, product names, and version numbers, which §5.3 keeps in Latin.
LATIN_ALLOWLIST = {
    "wywyg", "html", "getUpdates", "getChat", "getMe", "sendMessage",
    "setMyCommands", "setWebhook", "deleteWebhook", "getWebhookInfo",
    "pgron", "pg_cron", "pgnet", "pg_net", "pgsupabase",
    "supabase", "nextjs", "react", "tailwind", "typescript", "javascript",
    "api", "csrf", "rls", "totp", "aes", "gcm", "csp", "rpc", "postgres",
    "postgres", "next", "app", "router", "middleware", "proxy", "webhook",
    "bot", "hooks", "github", "google", "authenticator", "authy",
    "bitcoin", "alphadecimal", "npm", "npx", "vercel", "sql", "cron",
    "lib", "src", "env", "localhost", "json", "utf", "sha", "hmac", "otp",
    "id", "uuid", "url", "urls", "ip", "xss", "ssr", "cspnonce",
    # Terms already used in the existing components' Arabic copy.
    "http", "https", "Authentication", "WebAuthn", "MFA", "TOTP", "UTC",
    "README", "PWA", "OAuth", "CSRF", "CORS", "TLS", "SSL", "HMAC", "PBKDF",
    "argon", "bcrypt", "KDF", "IV", "GCM", "SRI", "COOP", "CORP", "HSTS",
}

# Latin runs of 3+ letters, and a string is "Arabic-dominant" when Arabic
# letters outnumber the Latin ones.
LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9_.\-]{2,}")
ARABIC_LETTER = re.compile(r"[؀-ۿݐ-ݿ]")
QUOTED = re.compile(r"[\"'\`]([^\"'\`\n]*)\"")

# Matched case-insensitively against a lowercased word, so the allowlist is
# written in whatever casing reads best.
LATIN_ALLOWED = {w.lower() for w in LATIN_ALLOWLIST}


def mixed_script_findings(file: str, text: str) -> list[str]:
    findings: list[str] = []
    for lineno, line in enumerate(text.split("\n"), 1):
        for match in QUOTED.finditer(line):
            snippet = match.group(1)
            if "/" in snippet and " " not in snippet:
                continue  # a path, route, or key, not prose
            if re.search(r"<[A-Za-z/]", snippet):
                continue  # an HTML template literal, not prose
            arabic = len(ARABIC_LETTER.findall(snippet))
            if arabic < 8:
                continue
            words = [w for w in LATIN_WORD.findall(snippet)]
            if not words:
                continue
            latin = sum(len(w) for w in words)
            if latin <= arabic // 3:
                continue
            suspicious = [
                w for w in words if w.lower().strip(".,") not in LATIN_ALLOWED
            ]
            if suspicious:
                findings.append(
                    f"{file}:{lineno}: latin word(s) {suspicious} inside Arabic "
                    f"string -> {snippet.strip()[:60]}"
                )
    return findings


def is_allowed(code: int) -> bool:
    return any(lo <= code <= hi for lo, hi in ALLOWED_RANGES)


def walk(paths: list[str]):
    for path in paths:
        if os.path.isfile(path):
            yield path
            continue
        for root, dirs, files in os.walk(path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in sorted(files):
                if name.endswith(TEXT_SUFFIXES):
                    yield os.path.join(root, name)


def main() -> int:
    targets = sys.argv[1:] or ["app", "components", "lib", "docs", "README.md"]
    findings: list[str] = []
    for file in walk(targets):
        try:
            text = io.open(file, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError) as exc:
            findings.append(f"{file}: unreadable ({exc})")
            continue
        for lineno, line in enumerate(text.split("\n"), 1):
            for col, ch in enumerate(line, 1):
                if is_allowed(ord(ch)):
                    continue
                findings.append(
                    f"{file}:{lineno}:{col}: U+{ord(ch):04X} -> {line.strip()[:70]}"
                )
        findings.extend(mixed_script_findings(file, text))
    for finding in findings:
        print(finding)
    if findings:
        print(f"\n{len(findings)} finding(s)")
        return 1
    print("clean: no characters or words outside Arabic/Latin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
