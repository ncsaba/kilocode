import * as path from "path"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { MemoryIndexManager } from "../../services/memory-index/manager"
import { getWorkspacePath } from "../../utils/path"

interface MemorySearchParams {
	query: string
	path?: string
}

export class MemorySearchTool extends BaseTool<"memory_search"> {
	readonly name = "memory_search" as const

	parseLegacy(params: Partial<Record<string, string>>): MemorySearchParams {
		return {
			query: params.query || "",
			path: params.path || undefined,
		}
	}

	async execute(params: MemorySearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const { query } = params
		let scopePath = params.path

		const workspacePath = task.cwd && task.cwd.trim() !== "" ? task.cwd : getWorkspacePath()
		if (!workspacePath) {
			await handleError("memory_search", new Error("Could not determine workspace path."))
			return
		}

		if (!query) {
			task.consecutiveMistakeCount++
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("memory_search", "query"))
			return
		}

		if (scopePath && path.isAbsolute(scopePath)) {
			scopePath = path.relative(workspacePath, scopePath)
		}

		const sharedMessageProps = {
			tool: "memorySearch",
			query,
			path: scopePath,
			isOutsideWorkspace: false,
		}

		const didApprove = await askApproval("tool", JSON.stringify(sharedMessageProps))
		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return
		}

		task.consecutiveMistakeCount = 0

		const manager = MemoryIndexManager.getInstance(task.providerRef.deref()?.context)
		if (!manager) {
			pushToolResult(formatResponse.toolError("Memory search is not available."))
			return
		}

		const status = manager.getStatus()
		if (status.state !== "ready") {
			const message =
				status.state === "disabled"
					? status.reason || "disabled"
					: status.state === "error"
						? status.error
						: "not ready"
			pushToolResult(formatResponse.toolError(`Memory search is unavailable: ${message}.`))
			return
		}

		try {
			const searchCwd = scopePath ? path.resolve(workspacePath, scopePath) : task.cwd
			const results = await manager.search(query, searchCwd)
			if (!results.length) {
				pushToolResult(`No relevant memory snippets found for the query: "${query}"`)
				return
			}

			const payload = {
				query,
				results: results.map((result) => ({
					filePath: result.filePath,
					score: result.score,
					startLine: result.startLine,
					endLine: result.endLine,
					content: result.content.trim(),
				})),
			}

			await task.say("memory_search_result", JSON.stringify({ tool: "memorySearch", content: payload }))
			const output = `Query: ${query}\nResults:\n\n${payload.results
				.map(
					(result) =>
						`${result.filePath}:${result.startLine}-${result.endLine} (score: ${result.score.toFixed(3)})\n${
							result.content
						}`,
				)
				.join("\n\n")}`
			pushToolResult(output)
		} catch (error) {
			await handleError("memory_search", error as Error)
		}
	}
}

export const memorySearchTool = new MemorySearchTool()
