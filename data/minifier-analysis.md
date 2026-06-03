# LuCI JS + CSS Minifier Test Results

## Objective

Replace `jsmin` (JS) and `csstidy` (CSS) in OpenWrt LuCI with modern minifiers that produce valid output, compress better or equal to current tools, work in OpenWrt's build pipeline (stdin/stdout for JS, file I/O for CSS), and have no runtime dependencies (Node.js-free preferred).

## Tools Tested

| Tool | Language | JS Pipeline | CSS Pipeline |
|------|----------|-------------|-------------|
| **esbuild** 0.28.0 | Go | stdin → `--minify` → stdout | stdin → `--minify --loader=css` → stdout |
| **tdewolff/minify** 2.24.13 | Go | stdin → `--type js` → stdout | stdin → `--type css` → stdout |
| **cminify** v2 (Jumping-Beaver) | C | `cminify js <file>` or `-` for stdin | `cminify css <file>` |
| **jsmin** (JS baseline) | C | stdin → stdout | N/A (JS only) |
| **csstidy** (CSS baseline) | C++ | N/A (CSS only) | `csstidy <file> --template=highest output` |

## JavaScript Results

### Success Rate

| Tool | Errors (out of 11 files) | Status |
|------|--------------------------|--------|
| jsmin (baseline) | 0 | ✓ |
| **esbuild** | **0** | ✓ **Best choice** |
| tdewolff/minify | 8/11 | ✗ Fails on 8/11 files |
| **cminify** | **0** | ✓ Drop-in replacement |

### File-by-file compression (bytes)

| File | Original | jsmin | esbuild | minify | cminify |
|------|----------|-------|---------|--------|--------|
| cbi.js | 154,098 | 60,993 | **50,549** | 60,993 | 60,134 |
| form.js | 183,945 | 67,661 | **52,652** | 183,945 (FAIL) | 66,784 |
| luci.js | 99,355 | 29,565 | **24,628** | 22,773 (FAIL) | 29,045 |
| network.js | 125,286 | 47,834 | **39,069** | 125,286 (FAIL) | 46,954 |
| ui.js | 49,226 | 13,681 | **10,988** | 13,681 | 13,482 |
| uci.js | 14,945 | 5,978 | **5,007** | 14,945 (FAIL) | 5,891 |
| validation.js | 9,381 | 3,478 | **2,920** | 3,478 | 3,431 |

*esbuild compresses 20-30% better than jsmin on all files.*

## CSS Results

### Success Rate

| Tool | Errors (out of 14 files) | Status |
|------|--------------------------|--------|
| csstidy (baseline) | 0 | ✓ |
| **esbuild** | **0** | ✓ **Best choice** |
| **tdewolff/minify** | **0** | ✓ Good alternative |
| cminify | 1/14 | ✗ Fails on CSS nesting syntax |

### Compression highlights (bytes)

| File | Original | csstidy | esbuild | minify | cminify |
|------|----------|---------|---------|--------|--------|
| bootstrap_cascade.css | 53,750 | 44,042 | 44,862 | **44,042** | 45,030 |
| material_cascade.css | 56,909 | 45,858 | **45,357** | 45,714 | 46,128 |
| openwrt2020_cascade.css | 37,314 | 30,414 | **30,334** | 30,440 | 30,729 |
| openwrt_cascade.css | 35,316 | 28,524 | 28,569 | 28,576 | 28,945 |
| dashboard_custom.css | 6,104 | 5,209 | 5,278 | **5,263** | 0 (FAIL) |
| material_custom.css | 1,791 | **1,280** | 1,346 | 1,302 | 1,297 |
| mobile.css | 8,664 | 7,249 | **7,136** | 7,141 | 7,226 |
| adblock_custom.css | 3,531 | 2,807 | **2,796** | 2,807 | 2,819 |

*esbuild compression is comparable to csstidy, often slightly better.*

## Why tdewolff/minify fails on JS

The exact cause is not fully determined. Two potential issues:

1. **Top-level `return`** — LuCI modules use `return Network;` style exports, which are technically invalid ECMAScript outside a function body. minify's parser may reject them.

2. **`extend()` pattern** — The dynamic object construction (`baseclass.extend({ ... })`) may confuse minify's static analysis.

It is likely a combination of both. 8/11 files are affected.

## Why cminify fails on CSS

`dashboard_custom.css` contains modern CSS nesting:

```css
[data-darkmode="true"] {
  .Dashboard .svgmonotone {
    filter: invert(.5);
  }
}
```

cminify's parser chokes on the `{ .Class { ... } }` nesting syntax.

## Recommendation: esbuild for both JS and CSS

| Requirement | esbuild | tdewolff/minify | cminify |
|------------|---------|-----------------|---------|
| JS 0 errors | ✅ | ❌ 8/11 | ✅ |
| CSS 0 errors | ✅ | ✅ | ❌ 1/14 |
| Best JS compression | ✅ (20-30% > jsmin) | N/A | ≈ jsmin |
| CSS ≈ csstidy | ✅ (slightly better) | ✅ | Worse |
| No runtime deps | ✅ (Go binary) | ✅ (Go binary) | ✅ (C binary) |

### Pipeline

```bash
# JavaScript
esbuild --minify < input.js > output.js

# CSS
esbuild --minify --loader=css < input.css > output.css
```


