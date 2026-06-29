---
name: temu-workbench
description: Operate the local TEMU AI workbench plugin for TEMU cross-border ecommerce workflows. Use when the user asks to collect 1688/TEMU/Amazon product assets, install or check the 1688 Chrome capture extension, run the local competitor dashboard, generate TEMU listing materials or backend form fields, package the dashboard for sharing/deployment, or troubleshoot this TEMU workspace.
---

# TEMU Workbench

Use this skill for the TEMU AI workbench. The public plugin intentionally does not bundle private workspace data, product records, generated listing packages, dashboard data, or TEMU source code. The default source workspace location is `~/Code/temu`. The workbench pipeline is:

```text
TEMU competitor -> 1688 same-product source -> Chrome capture extension -> local capture service -> dashboard data -> TEMU listing package -> static deploy package
```

## Entry Point

Prefer the plugin CLI instead of retyping commands:

```bash
temu-workbench <command>
```

If `temu-workbench` is not on `PATH`, install the wrapper from the plugin root:

```bash
packaging/install.sh
```

If installing the wrapper is not appropriate, run the bundled CLI directly from the plugin root:

```bash
node scripts/temu-workbench.mjs <command>
```

Useful commands:

- `doctor`: check Node/npm, workspace, dashboard data, Chrome extension build, capture service port, and deploy package.
- `install`: run `doctor`, install dependencies if needed, build the Chrome extension, and build the dashboard.
- `extension`: build and copy the 1688 Chrome extension, then print the unpacked extension path for Chrome.
- `capture`: start the local capture service on `127.0.0.1:9788`.
- `dashboard`: start the workbench at `http://127.0.0.1:5177`.
- `listing --offer-id=<id> [--declaration-price-cny=<number>]`: generate the TEMU listing package for a 1688 offer.
- `package`: build the static dashboard deploy package and zip.
- `smoke`: run the focused build/typecheck/smoke checks for the dashboard and capture extension.

Use `--workspace=<path>` or `TEMU_WORKSPACE=<path>` when the source repo is not at `~/Code/temu`. Without the user's own source workspace, the plugin can only provide instructions and the bundled Chrome extension.

## Chrome Extension

The Chrome extension is required for real page capture. It is an unpacked MV3 extension, not a Chrome Web Store package.

Always make sure both pieces are available:

1. Local service: `temu-workbench capture`, which requires the user's own TEMU workspace.
2. Chrome extension: load the printed `chrome-mv3` folder in `chrome://extensions/` with Developer mode enabled.

If capture fails, check that the service is listening on `127.0.0.1:9788` and that Chrome has reloaded the latest unpacked extension folder.

## Listing Package

For a listing request, require an explicit 1688 offer id. Do not infer or hardcode a product id.

Example:

```bash
temu-workbench listing --offer-id=<1688OfferId> --declaration-price-cny=<amount>
```

After generation, use the user's own dashboard project page to copy text fields and upload images/videos manually into TEMU.

## Deploy Package

For sharing a fresh static dashboard from the source workspace, run:

```bash
temu-workbench package
```

The source-workspace output zip is:

```text
apps/competitor-dashboard/deploy/temu-dashboard-static.zip
```

The public plugin release does not include private dashboard data or product assets. Real dashboard preview, listing generation, and deployment packages must be built from the user's own workspace.

## Validation

For workbench UI or data-flow changes, run:

```bash
temu-workbench smoke
```

If only packaging the existing dashboard, `temu-workbench package` is enough.
