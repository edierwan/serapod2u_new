# Map assets

## malaysia-states.geojson

Malaysia state/negeri administrative boundaries used by the "Shop by Negeri"
reporting map (`MalaysiaStateMap`).

- **Source**: Code for America — "click_that_hood" project
  (https://github.com/codeforgermany/click_that_hood), file
  `public/data/malaysia.geojson`.
- **License**: MIT License (Copyright (c) 2013-2021 Code for America). Safe to
  redistribute/commit.
- **Modifications**: state names normalized (e.g. "Federal Territory of Kuala
  Lumpur" -> "Kuala Lumpur"), coordinates rounded to 4 decimals to reduce file
  size, and a simplified Labuan polygon was appended (the source omitted it).

No external CDN is loaded at runtime — the component reads this local static file.
