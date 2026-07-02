TEMU AI Workbench single package

This zip contains:
- Codex plugin manifest and skill
- temu-workbench CLI
- built 1688/TEMU Chrome capture extension
- no private product data, generated listing assets, dashboard data, or source workspace

Quick start:
1. Unzip the package.
2. Run: packaging/install.sh
3. Check environment: temu-workbench doctor
4. Request authorization: temu-workbench license request
5. Import authorization: temu-workbench license import ./license.json
6. Full local workflow requires your own TEMU workspace.
7. Load assets/chrome-extension/chrome-mv3 in chrome://extensions/ after building or installing your workspace.

License:
- Business commands require a valid offline machine authorization.
- Allowed before authorization: help, version, doctor, license, install, extension.
- Blocked without authorization: capture, dashboard, listing, package, smoke.
- A license can be imported from license.json or with:
  temu-workbench license import --code=<machine-auth-code>
