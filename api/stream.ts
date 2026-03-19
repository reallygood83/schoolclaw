import type { AssistantMessageEvent, Context, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import type { ProxyAssistantMessageEvent } from "@mariozechner/pi-agent-core";
import { list } from "@vercel/blob";

export const maxDuration = 60;

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const MODEL_ID = "qwen-3-235b-a22b-instruct-2507";
const MAX_TOKENS = 1200;
const TEMPERATURE = 0.3;

async function loadKnowledge(): Promise<string> {
	try {
		const { blobs } = await list({ prefix: "documents/" });
		const extractedBlobs = blobs.filter((b) => b.pathname.endsWith(".extracted.json"));

		const allParagraphs: string[] = [];
		for (const blob of extractedBlobs) {
			const res = await fetch(blob.url);
			const data = (await res.json()) as { paragraphs: string[] };
			allParagraphs.push(...data.paragraphs);
		}
		return allParagraphs.join("\n");
	} catch {
		return "";
	}
}

function toProxyEvent(event: AssistantMessageEvent): ProxyAssistantMessageEvent | undefined {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return { type: "text_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "text_end":
			return { type: "text_end", contentIndex: event.contentIndex };
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return { type: "thinking_delta", contentIndex: event.contentIndex, delta: event.delta };
		case "thinking_end":
			return { type: "thinking_end", contentIndex: event.contentIndex };
		case "toolcall_start":
			return undefined;
		case "toolcall_delta":
			return undefined;
		case "toolcall_end":
			return undefined;
		case "done":
			return { type: "done", reason: event.reason, usage: event.message.usage };
		case "error":
			return { type: "error", reason: event.reason, errorMessage: event.error.errorMessage, usage: event.error.usage };
		default:
			return undefined;
	}
}

export async function POST(req: Request): Promise<Response> {
	if (!CEREBRAS_API_KEY) {
		return new Response(JSON.stringify({ error: "Server API key not configured" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}

	let body: { context?: { messages?: unknown[] }; options?: { maxTokens?: number } };
	try {
		body = await req.json();
	} catch {
		return new Response(JSON.stringify({ error: "Invalid request body" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	}

	const messages = Array.isArray(body?.context?.messages) ? body.context.messages : [];
	const model = getModel("cerebras", MODEL_ID);

	const knowledge = await loadKnowledge();
	const knowledgeBlock = knowledge ? `\n\n## 학교 문서 데이터\n아래는 관리자가 업로드한 학교 문서에서 추출한 내용입니다. 이 내용을 참고하여 답변하세요.\n\n${knowledge}` : "";

	const systemPrompt = (typeof body?.context === "object" && body.context !== null && "systemPrompt" in body.context && typeof (body.context as { systemPrompt?: unknown }).systemPrompt === "string")
		? (body.context as { systemPrompt: string }).systemPrompt
		: "";

	const context: Context = {
		systemPrompt: systemPrompt + knowledgeBlock,
		messages: messages as Context["messages"],
		tools: [],
	};

	const streamOptions: SimpleStreamOptions = {
		apiKey: CEREBRAS_API_KEY,
		maxTokens: Math.min(body?.options?.maxTokens ?? MAX_TOKENS, MAX_TOKENS),
		temperature: TEMPERATURE,
	};

	const encoder = new TextEncoder();
	const readable = new ReadableStream({
		async start(controller) {
			try {
				const llmStream = streamSimple(model, context, streamOptions);
				for await (const event of llmStream) {
					const proxyEvent = toProxyEvent(event);
					if (proxyEvent) {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify(proxyEvent)}\n\n`));
					}
				}
			} catch (err) {
				const errorEvent: ProxyAssistantMessageEvent = {
					type: "error",
					reason: "error",
					errorMessage: err instanceof Error ? err.message : String(err),
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				};
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
			} finally {
				controller.close();
			}
		},
	});

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
