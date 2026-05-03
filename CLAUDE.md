# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style

- Only add comments for complex or non-obvious logic. Do not comment straightforward code.

## Commands

```bash
# First-time setup (installs deps, generates Prisma client, runs migrations)
npm run setup

# Development server (localhost:3000)
npm run dev

# Build for production
npm run build

# Run all tests
npm test

# Run a single test file
npx vitest run src/components/chat/__tests__/ChatInterface.test.tsx

# Lint
npm run lint

# Reset the SQLite database
npm run db:reset
```

> **Windows note:** The dev/build/start scripts use `cross-env` to set `NODE_OPTIONS`. Without it, PowerShell will reject the Unix-style `VAR='value' cmd` syntax with a "not recognized as an internal command" error.

## Environment Variables

```
ANTHROPIC_API_KEY=   # Optional; omit to use the mock provider (no API costs)
JWT_SECRET=          # Optional; defaults to "development-secret-key" in dev
```

## Architecture

### AI generation pipeline

`POST /api/chat` ([src/app/api/chat/route.ts](src/app/api/chat/route.ts)) is the core endpoint. It:
1. Prepends the system prompt ([src/lib/prompts/generation.tsx](src/lib/prompts/generation.tsx)) with Anthropic prompt cache control
2. Deserializes the `VirtualFileSystem` from JSON sent by the client
3. Calls `streamText` (Vercel AI SDK) with up to 40 tool steps (4 for mock to prevent loops)
4. Streams tool calls back to the client, which applies them client-side in real time
5. On finish, saves messages + serialized VFS to SQLite (authenticated users only)

Claude has two tools:
- **`str_replace_editor`** — `create`, `str_replace`, `insert`, `view`, `undo_edit` operations on virtual files ([src/lib/tools/str-replace.ts](src/lib/tools/str-replace.ts))
- **`file_manager`** — `rename` and `delete` operations ([src/lib/tools/file-manager.ts](src/lib/tools/file-manager.ts))

### Virtual file system

`VirtualFileSystem` ([src/lib/file-system.ts](src/lib/file-system.ts)) is a pure in-memory tree — nothing is written to disk. It serializes to/from `Record<string, FileNode>` for transport. The client holds the canonical copy; the server reconstructs it per request from the JSON body.

`FileSystemContext` ([src/lib/contexts/file-system-context.tsx](src/lib/contexts/file-system-context.tsx)) wraps the VFS in React state and exposes a `handleToolCall` callback. `ChatContext` ([src/lib/contexts/chat-context.tsx](src/lib/contexts/chat-context.tsx)) connects the Vercel AI SDK `useChat` hook's `onToolCall` to that callback, so every tool call from Claude mutates the VFS and triggers a UI refresh immediately.

### Preview rendering

`createImportMap` + `createPreviewHTML` ([src/lib/transform/jsx-transformer.ts](src/lib/transform/jsx-transformer.ts)) convert the VFS into a self-contained HTML page:
1. Each `.jsx/.tsx/.js/.ts` file is Babel-transformed client-side (`@babel/standalone`) into plain JS
2. Transformed modules become blob URLs
3. An `<script type="importmap">` maps all import paths (including `@/` alias and extension-less variants) to their blob URLs
4. Third-party bare imports are resolved via `https://esm.sh/<package>`
5. CSS imports are collected into a `<style>` tag; the imports are stripped from JS
6. Tailwind is loaded via CDN `<script src="https://cdn.tailwindcss.com">` inside the iframe
7. The HTML is injected into a sandboxed `<iframe>` in `PreviewFrame`; syntax errors show an error overlay instead of running code

**Entry point contract:** The generated app must have `/App.jsx` with a default export. The `@/` import alias maps to the VFS root `/`.

### Model provider

`getLanguageModel()` ([src/lib/provider.ts](src/lib/provider.ts)) returns:
- **Real Claude** (`claude-haiku-4-5` via `@ai-sdk/anthropic`) when `ANTHROPIC_API_KEY` is set
- **`MockLanguageModel`** (hardcoded counter/form/card components) when the key is absent — useful for UI development without API costs

### Auth & persistence

- JWT sessions via `jose`, stored in an httpOnly cookie (`auth-token`), 7-day expiry ([src/lib/auth.ts](src/lib/auth.ts))
- `JWT_SECRET` env var; falls back to `"development-secret-key"` in dev
- `src/middleware.ts` guards `/api/projects` and `/api/filesystem` routes; all other routes (including `/api/chat`) are public
- Prisma + SQLite (`prisma/dev.db`) stores `User` and `Project` records; projects persist `messages` (JSON) and `data` (serialized VFS JSON)
- Prisma client is generated to `src/generated/prisma` (not the default `node_modules/.prisma`) — import from there, not `@prisma/client`
- Anonymous users can work freely; their chat state is tracked in **sessionStorage** via `anon-work-tracker` and can be saved to a project upon sign-up
- **Database schema:** Always reference [prisma/schema.prisma](prisma/schema.prisma) to understand table structure before writing any DB queries or migrations

### Server actions & app routes

- DB mutations (signIn, signUp, createProject, etc.) are Next.js server actions in `src/actions/`; re-exported from `src/actions/index.ts`
- App routes: `/` (home/landing), `/[projectId]` (project workspace with chat + editor + preview panels)
- `src/app/main-content.tsx` is the UI shell — three resizable panels (chat, editor, preview) using `react-resizable-panels`

### UI components

- `src/components/ui/` contains shadcn/ui primitives (Button, Dialog, Input, Tabs, etc.) — extend these rather than writing from scratch
- Use the `cn()` helper from `src/lib/utils.ts` (wraps `clsx` + `tailwind-merge`) for all conditional className composition

### Node compatibility shim

`node-compat.cjs` deletes `globalThis.localStorage` and `globalThis.sessionStorage` on the server side. This is required on Node 25+, which exposes non-functional Web Storage globals by default, causing SSR crashes in dependencies that detect the globals and assume a browser environment.

## Tests

Tests live in `__tests__/` directories colocated with the code they cover, using Vitest + jsdom + React Testing Library. Key test files:

- `src/lib/__tests__/file-system.test.ts` — VirtualFileSystem operations and serialization
- `src/lib/__tests__/auth.test.ts` — JWT session functions
- `src/lib/transform/__tests__/jsx-transformer.test.ts` — Babel transformation and import map generation
- `src/lib/contexts/__tests__/` — FileSystemContext and ChatContext hooks
- `src/components/chat/__tests__/` — Chat UI components
- `src/components/editor/__tests__/` — Editor components
- `src/hooks/__tests__/use-auth.test.ts` — Auth hook including anon-work migration
- `src/actions/__tests__/` — Server actions (signIn, signUp, createProject, etc.)
