---
title: "Memory Indexing"
description: "Semantic search over project memory files"
---

# Memory Indexing

Memory Indexing lets Kilo Code semantically search your project memory files (for example `MEMORY.md` and `memory/**/*.md`). It uses embeddings and a local Postgres + pgvector database so the assistant can retrieve relevant memory on demand.

## What It Does

When enabled, Memory Indexing:

1. **Finds memory files** in each repo root (folders with a `.git` directory)
2. **Parses and chunks** markdown content using the same semantic parser as code indexing
3. **Creates embeddings** using your configured embedding provider
4. **Stores vectors** in Postgres + pgvector for fast similarity search
5. **Provides the [`memory_search`](/docs/automate/tools/memory-search) tool** to the assistant

## Setup Requirements

### Postgres + pgvector

Memory Indexing requires a Postgres database with the `pgvector` extension. Kilo Code connects using:

- `KILO_PGVECTOR_URL` if set
- Otherwise it probes `postgresql://kilocode@localhost:5432/kilocode`

If no connection is available, Memory Indexing is disabled until a connection succeeds.

### Embedding Provider

Configure one or more embedding providers via settings:

- `kilo-code.memoryIndex.providers` (ordered fallback list)
- `kilo-code.memoryIndex.modelId`
- `kilo-code.memoryIndex.modelDimension` (optional override)

All providers must return embeddings with the same dimension.

## Configuration

Open VS Code settings and search for **Memory Index** to configure:

- **Enable Memory Indexing**: `kilo-code.memoryIndex.enabled`
- **Memory file name**: `kilo-code.memoryIndex.memoryFileName` (default `MEMORY.md`)
- **Memory directory**: `kilo-code.memoryIndex.memoryDirName` (default `memory`)
- **Include memory files**: `kilo-code.memoryIndex.includeMemoryFile`
- **Include memory directory**: `kilo-code.memoryIndex.includeMemoryDir`
- **Embedding providers**: `kilo-code.memoryIndex.providers`
- **Embedding model**: `kilo-code.memoryIndex.modelId`
- **Embedding dimension**: `kilo-code.memoryIndex.modelDimension`

## Status Panel

The chat input shows a Memory Index status badge. Click it to view current status and retry the Postgres connection if needed.

## How Files Are Tracked

For each repo root, Kilo Code stores a marker file named `.kilocode-memory-index.json`. This records the index ID so multiple dev containers can reuse the same memory index even if the mount path changes.

## Using Memory Search

Once ready, the assistant can call the [`memory_search`](/docs/automate/tools/memory-search) tool to retrieve relevant memory snippets with file paths and line ranges.

## Troubleshooting

- **Status shows Disabled**: Ensure Postgres + pgvector is running and reachable, or set `KILO_PGVECTOR_URL`.
- **Status shows Error**: Open the badge and click **Retry connection** after fixing the database or embedding configuration.
- **No results**: Confirm memory files exist and `kilo-code.memoryIndex.includeMemoryFile` / `includeMemoryDir` are enabled.
