# **PROJECT_NAME**

**DESCRIPTION**

### Structure

- `packages/`: workspace packages
- `asset/`: shared documentation and assets
- Root configuration: `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.json`

### Tooling

| Tool           | Purpose                             |
| :------------- | :---------------------------------- |
| **pnpm**       | Dependency management               |
| **tsdown**     | Library build (Rolldown + Oxc)      |
| **Turborepo**  | High-performance task orchestration |
| **Changesets** | Versioning and changelog generation |
| **TypeScript** | Type-safe code (TypeScript 7)       |
| **Vitest**     | Unit testing                        |
| **Oxlint**     | Linter                              |
| **Oxfmt**      | Formatter                           |

### Requirements

- Node.js `^22.18.0 || ^24.11.0 || >=26.0.0` (`.nvmrc` pins 24.19.0)
- pnpm `10.20.0`

### Getting Started

```bash
pnpm install
pnpm build
```

### Development

| Command               | Description                                        |
| :-------------------- | :------------------------------------------------- |
| `pnpm dev`            | Start development servers for all packages.        |
| `pnpm build`          | Build all packages with Turbo caching.             |
| `pnpm build:clean`    | Clean `dist` and force a full rebuild.             |
| `pnpm build:fast`     | Build without declaration generation.              |
| `pnpm test`           | Run tests in watch mode.                           |
| `pnpm test:coverage`  | Run tests once with coverage.                      |
| `pnpm lint`           | Lint all packages.                                 |
| `pnpm format`         | Format all files with Oxfmt.                       |
| `pnpm check`          | Run Oxlint and verify formatting.                  |
| `pnpm ts:typecheck`   | Type-check every package.                          |
| `pnpm verify:package` | Validate the existing build, tarball, and imports. |
| `pnpm reset`          | Clean build artifacts and `node_modules`.          |

### Packages

The starter package lives in `packages/ic`.

### Versioning

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing.

| Command            | Description                                                          |
| :----------------- | :------------------------------------------------------------------- |
| `pnpm pkg:init`    | Create a new changeset. This will prompt you for the type of change. |
| `pnpm pkg:version` | Apply changesets and bump package versions.                          |
| `pnpm pkg:publish` | Publish packages to the registry.                                    |
