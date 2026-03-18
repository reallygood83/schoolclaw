import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type FaqItem = {
	category: string;
	question: string;
	answer: string;
};

type SchoolConfig = {
	schoolInfo: {
		name: string;
		address: string;
		phone: string;
		fax: string;
		principal: string;
		vicePrincipal: string;
		website: string;
		foundedYear: number;
		studentCount: number;
		classCount: number;
		teacherCount: number;
	};
	model: {
		provider: string;
		modelId: string;
	};
	ui: {
		tagline: string;
		welcomeTitle: string;
		welcomeDescription: string;
		recommendedQuestions: string[];
	};
	faq: FaqItem[];
};

type CliOptions = {
	input: string;
	output: string;
	base: string;
};

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	trimValues: true,
	removeNSPrefix: true,
});

function parseArgs(argv: string[]): CliOptions {
	const args = new Map<string, string>();

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const value = argv[i + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for ${arg}`);
		}
		args.set(arg.slice(2), value);
		i += 1;
	}

	const input = args.get("input");
	if (!input) {
		throw new Error("Usage: npm run extract:hwpx -- --input <file-or-dir> [--output ./school-config.generated.json] [--base ./school-config.json]");
	}

	return {
		input,
		output: args.get("output") ?? path.resolve(process.cwd(), "school-config.generated.json"),
		base: args.get("base") ?? path.resolve(process.cwd(), "school-config.json"),
	};
}

async function collectHwpxFiles(inputPath: string): Promise<string[]> {
	const resolved = path.resolve(process.cwd(), inputPath);
	const stats = await stat(resolved);

	if (stats.isFile()) {
		if (!resolved.toLowerCase().endsWith(".hwpx")) {
			throw new Error(`Expected a .hwpx file: ${resolved}`);
		}
		return [resolved];
	}

	const entries = await readdir(resolved, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".hwpx"))
		.map((entry) => path.join(resolved, entry.name))
		.sort((a, b) => a.localeCompare(b, "ko"));
}

function toArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function collectParagraphs(node: unknown, paragraphs: string[]): void {
	if (typeof node === "string") return;
	if (Array.isArray(node)) {
		for (const item of node) collectParagraphs(item, paragraphs);
		return;
	}
	if (!node || typeof node !== "object") return;

	for (const [key, value] of Object.entries(node)) {
		if (key === "p") {
			for (const paragraph of toArray(value)) {
				const text = collectText(paragraph).replace(/\s+/g, " ").trim();
				if (text) paragraphs.push(text);
			}
			continue;
		}
		collectParagraphs(value, paragraphs);
	}
}

function collectText(node: unknown): string {
	if (typeof node === "string") return decodeXml(node);
	if (Array.isArray(node)) return node.map((item) => collectText(item)).join(" ");
	if (!node || typeof node !== "object") return "";

	let text = "";
	for (const [key, value] of Object.entries(node)) {
		if (key === "p") continue;
		text += ` ${collectText(value)}`;
	}
	return text;
}

function decodeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

async function extractParagraphsFromHwpx(filePath: string): Promise<string[]> {
	const buffer = await readFile(filePath);
	const zip = await JSZip.loadAsync(buffer);
	const sectionFiles = Object.keys(zip.files)
		.filter((name) => name.startsWith("Contents/") && name.endsWith(".xml"))
		.sort((a, b) => a.localeCompare(b, "en"));

	const paragraphs: string[] = [];

	for (const fileName of sectionFiles) {
		const entry = zip.file(fileName);
		if (!entry) continue;
		const xml = await entry.async("string");
		const parsed = parser.parse(xml);
		collectParagraphs(parsed, paragraphs);
	}

	return paragraphs
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean);
}

function looksLikeQuestion(line: string): boolean {
	return (
		/^q[.:)\s]/i.test(line) ||
		line.endsWith("?") ||
		/어떻게|언제|어디서|어디로|무엇|몇 시|가능한가요|있나요|하나요|되나요/.test(line)
	);
}

function looksLikeCategory(line: string): boolean {
	const normalized = line.replace(/[[\]<>]/g, "").trim();
	if (!normalized) return false;
	if (normalized.length > 20) return false;
	if (looksLikeQuestion(normalized)) return false;
	return /^[가-힣A-Za-z0-9·/ ]+$/.test(normalized);
}

function normalizeQuestion(line: string): string {
	return line.replace(/^q[.:)\s-]*/i, "").trim();
}

function normalizeAnswer(lines: string[]): string {
	return lines
		.map((line) => line.replace(/^a[.:)\s-]*/i, "").trim())
		.filter(Boolean)
		.join(" ");
}

function buildFaq(paragraphs: string[]): FaqItem[] {
	const faq: FaqItem[] = [];
	let currentCategory = "기타";
	let currentQuestion: string | null = null;
	let answerLines: string[] = [];

	const flush = () => {
		if (!currentQuestion) return;
		const answer = normalizeAnswer(answerLines);
		if (answer) {
			faq.push({
				category: currentCategory,
				question: currentQuestion,
				answer,
			});
		}
		currentQuestion = null;
		answerLines = [];
	};

	for (const paragraph of paragraphs) {
		const line = paragraph.trim();
		if (!line) continue;

		if (looksLikeCategory(line)) {
			flush();
			currentCategory = line.replace(/[[\]<>]/g, "").trim();
			continue;
		}

		if (looksLikeQuestion(line)) {
			flush();
			currentQuestion = normalizeQuestion(line);
			continue;
		}

		if (currentQuestion) {
			answerLines.push(line);
		}
	}

	flush();
	return faq;
}

async function readBaseConfig(basePath: string): Promise<SchoolConfig> {
	const raw = await readFile(basePath, "utf8");
	return JSON.parse(raw) as SchoolConfig;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const files = await collectHwpxFiles(options.input);

	if (files.length === 0) {
		throw new Error("No .hwpx files found.");
	}

	const paragraphs = (await Promise.all(files.map((file) => extractParagraphsFromHwpx(file)))).flat();
	const faq = buildFaq(paragraphs);
	const baseConfig = await readBaseConfig(options.base);

	const outputConfig: SchoolConfig = {
		...baseConfig,
		faq,
	};

	await writeFile(options.output, `${JSON.stringify(outputConfig, null, "\t")}\n`, "utf8");

	console.log(`Parsed files: ${files.length}`);
	console.log(`Extracted paragraphs: ${paragraphs.length}`);
	console.log(`Generated FAQ items: ${faq.length}`);
	console.log(`Wrote: ${options.output}`);

	if (faq.length === 0) {
		console.log("No FAQ pairs were detected. Check the source document structure and adjust the heuristics if needed.");
		console.log("Typical usage: npm run extract:hwpx -- --input ./docs --output ./school-config.generated.json");
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
