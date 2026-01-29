---
'@rsc-xray/analyzer': patch
---

Fix ES module imports by adding .js extensions to all relative imports/exports. This resolves module resolution errors when importing the package in Node.js environments.
