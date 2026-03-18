import type { Message } from "@mariozechner/pi-ai";
import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { defaultConvertToLlm, registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

export interface ParentHelpMessage {
	role: "parent-help";
	phone: string;
	schoolName: string;
	homepageUrl: string;
	sourceLabel?: string;
	sourceUrl?: string;
	timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		"parent-help": ParentHelpMessage;
	}
}

const parentHelpRenderer: MessageRenderer<ParentHelpMessage> = {
	render: (message) => {
		return html`
			<div class="parent-help-shell">
				<div class="parent-help-card">
					<div class="parent-help-header">
						<div class="parent-help-kicker">바로 확인하기</div>
						<div class="parent-help-title">학교 안내와 문의처</div>
					</div>
					<div class="parent-help-grid ${message.sourceUrl ? "parent-help-grid--three" : "parent-help-grid--two"}">
						${
							message.sourceUrl
								? html`<a
										href=${message.sourceUrl}
										target="_blank"
										rel="noreferrer"
										class="parent-help-link"
									>
										<div class="parent-help-link-label">출처 확인</div>
										<div class="parent-help-link-value">${message.sourceLabel || "학교 홈페이지 안내"}</div>
									</a>`
								: null
						}
						<a
							href=${message.homepageUrl}
							target="_blank"
							rel="noreferrer"
							class="parent-help-link"
						>
							<div class="parent-help-link-label">학교 홈페이지</div>
							<div class="parent-help-link-value">바로가기</div>
						</a>
						<a
							href=${`tel:${message.phone.replace(/-/g, "")}`}
							class="parent-help-link"
						>
							<div class="parent-help-link-label">학교 문의</div>
							<div class="parent-help-link-value">${message.schoolName} ${message.phone}</div>
						</a>
					</div>
				</div>
			</div>
		`;
	},
};

export function registerCustomMessageRenderers() {
	registerMessageRenderer("parent-help", parentHelpRenderer);
}

export function createParentHelpMessage(
	phone: string,
	schoolName: string,
	homepageUrl: string,
	sourceLabel?: string,
	sourceUrl?: string,
): ParentHelpMessage {
	return {
		role: "parent-help",
		phone,
		schoolName,
		homepageUrl,
		sourceLabel,
		sourceUrl,
		timestamp: Date.now(),
	};
}

export function customConvertToLlm(messages: AgentMessage[]): Message[] {
	return defaultConvertToLlm(messages.filter((message) => message.role !== "parent-help"));
}
