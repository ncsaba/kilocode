# memory_search

The `memory_search` tool performs semantic searches over your project memory files (for example `MEMORY.md` and `memory/**/*.md`). It uses the Memory Indexing feature, which stores embeddings in Postgres + pgvector.

## Requirements

The tool is only available when Memory Indexing is configured and the index is ready:

- **Memory Index enabled**: `kilo-code.memoryIndex.enabled` is `true`
- **Postgres + pgvector available**: `KILO_PGVECTOR_URL` is set or a local `postgresql://kilocode@localhost:5432/kilocode` instance is reachable
- **Embedding provider configured**: `kilo-code.memoryIndex.providers` and `kilo-code.memoryIndex.modelId`

## Parameters

- `query` (string, required): Natural language search query
- `path` (string, optional): Limit search to the current workspace or a specific path

## How It Works

1. Generates an embedding for your query
2. Searches memory chunks stored in pgvector
3. Returns matching snippets with file paths and line ranges

## Example

```xml
<memory_search>
<query>project naming conventions for services</query>
</memory_search>
```

## Output

The tool returns:

- File path
- Line range
- Similarity score
- Content snippet

## Tips

- Keep memory files focused and well-structured to improve search quality
- Use clear headings and concise entries in memory docs
