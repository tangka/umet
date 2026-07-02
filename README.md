# UMET Codex Marketplace

UMET marketplace for Codex plugins.

## Install

```bash
codex plugin marketplace add tangka/umet
codex plugin add temu-ai-workbench@umet
```

## TEMU AI Workbench

The `temu-ai-workbench` plugin includes:

- Codex skill metadata
- `temu-workbench` local CLI
- built 1688/TEMU Chrome capture extension
- no private product data, generated listing assets, dashboard data, or source workspace

It does not include the private TEMU source workspace. Full source-workspace generation workflows require a local TEMU workspace.

Useful commands after install:

```bash
temu-workbench doctor
temu-workbench license request
temu-workbench license import ./license.json
temu-workbench license status
temu-workbench extension
temu-workbench capture
```

## License

The first public version uses offline machine authorization. Users run:

```bash
temu-workbench license request
```

Send the `machineId` to the Umet service provider. After receiving `license.json` or a machine authorization code:

```bash
temu-workbench license import ./license.json
# or
temu-workbench license import --code=<machine-auth-code>
temu-workbench license status
```

Without a valid license, setup commands still work, but business commands such as `capture`, `dashboard`, `listing`, `package`, and `smoke` are blocked.
