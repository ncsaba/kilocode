import React, { useMemo } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import type { MemoryIndexStatus } from "@roo-code/types"

import { Popover, PopoverContent, Button } from "@src/components/ui"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"
import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"

interface MemoryIndexPopoverProps {
	children: React.ReactNode
	status: MemoryIndexStatus
}

export const MemoryIndexPopover: React.FC<MemoryIndexPopoverProps> = ({ children, status }) => {
	const { t } = useAppTranslation()

	const statusLabel = useMemo(() => {
		switch (status.state) {
			case "disabled":
				return t("settings:memoryIndex.status.disabled")
			case "connecting":
				return t("settings:memoryIndex.status.connecting")
			case "ready":
				return t("settings:memoryIndex.status.ready")
			case "error":
				return t("settings:memoryIndex.status.error")
			default:
				return t("settings:memoryIndex.status.unknown")
		}
	}, [status.state, t])

	const statusClass = useMemo(() => {
		switch (status.state) {
			case "ready":
				return "text-green-400"
			case "error":
				return "text-red-400"
			case "connecting":
				return "text-yellow-400"
			default:
				return "text-vscode-descriptionForeground"
		}
	}, [status.state])

	const detailText = useMemo(() => {
		if (status.state === "ready") {
			return t("settings:memoryIndex.readyDetail", { count: status.indexedRepos })
		}
		if (status.state === "disabled") {
			return status.reason
				? t("settings:memoryIndex.disabledDetail", { reason: status.reason })
				: t("settings:memoryIndex.disabledDetailFallback")
		}
		if (status.state === "error") {
			return status.error
				? t("settings:memoryIndex.errorDetail", { error: status.error })
				: t("settings:memoryIndex.errorDetailFallback")
		}
		return t("settings:memoryIndex.connectingDetail")
	}, [status, t])

	return (
		<Popover>
			{children}
			<PopoverContent className="w-80">
				<div className="flex items-center justify-between gap-3">
					<h4 className="m-0 text-sm font-semibold">{t("settings:memoryIndex.title")}</h4>
					<VSCodeLink
						href={buildDocLink("customize/context/memory-indexing", "memory_index_status")}
						className="text-xs">
						{t("settings:memoryIndex.docsLink")}
					</VSCodeLink>
				</div>
				<p className="text-xs text-vscode-descriptionForeground mt-2">
					{t("settings:memoryIndex.description")}
				</p>

				<div className="mt-3 space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-xs font-medium text-vscode-descriptionForeground">
							{t("settings:memoryIndex.statusTitle")}
						</span>
						<span className={cn("text-xs font-semibold", statusClass)}>{statusLabel}</span>
					</div>
					<p className="text-xs text-vscode-descriptionForeground">{detailText}</p>
				</div>

				<div className="mt-4 flex items-center justify-end gap-2">
					<Button
						onClick={() => vscode.postMessage({ type: "memoryIndexRetryConnection" })}
						disabled={status.state === "connecting"}
						variant="secondary"
						size="sm">
						{t("settings:memoryIndex.retryButton")}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
