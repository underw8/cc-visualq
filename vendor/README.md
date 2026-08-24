# vendor

Third-party code, committed rather than installed. `claude plugin install`
copies the repo; it never runs `npm install`, so a dependency that is not in
the tree is a dependency that is not there at runtime.

## mermaid.min.js

| | |
|---|---|
| version | 11.17.0 (pinned) |
| source | `https://cdn.jsdelivr.net/npm/mermaid@11.17.0/dist/mermaid.min.js` |
| sha256 | `8d8e0eec56d3a83b4b3c87f42050845546dee93ebe1875d2117c12e6947c0cb3` |
| bytes | 3572296 |
| license | MIT — headers retained inline in the bundle |

This build resolves no dynamic `import()`, so the one file is the whole
library: nothing is fetched at runtime and the page stays self-contained on
loopback. It is an IIFE that assigns `globalThis.mermaid`, so a plain
`<script src>` is enough — no module type, no import map.

Replacing it means re-checking all three: the byte count, the hash, and that
`import(` still appears zero times. A build that lazy-loads its diagram
registry would 404 against the hook's server and fail silently.

    curl -sL -o vendor/mermaid.min.js \
      https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js
    shasum -a 256 vendor/mermaid.min.js
    grep -c 'import(' vendor/mermaid.min.js
