import { schoolConfig } from "./school-config.js";

export function buildSystemPrompt(): string {
	const { schoolInfo, faq } = schoolConfig;
	const schoolInfoLines = [
		`- 학교명: ${schoolInfo.name}`,
		`- 주소: ${schoolInfo.address}`,
		`- 전화: ${schoolInfo.phone}`,
		`- 팩스: ${schoolInfo.fax}`,
		schoolInfo.principal ? `- 교장: ${schoolInfo.principal}` : "",
		schoolInfo.vicePrincipal ? `- 교감: ${schoolInfo.vicePrincipal}` : "",
		`- 홈페이지: ${schoolInfo.website}`,
		schoolInfo.foundedYear ? `- 설립년도: ${schoolInfo.foundedYear}년` : "",
		schoolInfo.studentCount ? `- 학생 수: 약 ${schoolInfo.studentCount}명` : "",
		schoolInfo.classCount ? `- 학급 수: ${schoolInfo.classCount}개` : "",
		schoolInfo.teacherCount ? `- 교직원 수: ${schoolInfo.teacherCount}명` : "",
	]
		.filter(Boolean)
		.join("\n");
	const categories = [...new Set(faq.map((item) => item.category))];
	let faqText = "";

	for (const category of categories) {
		faqText += `\n## ${category}\n\n`;
		for (const item of faq.filter((entry) => entry.category === category)) {
			faqText += `**Q: ${item.question}**\nA: ${item.answer}\n`;
			if (item.sourceUrl) {
				faqText += `출처: ${item.sourceLabel || "학교 홈페이지"} (${item.sourceUrl})\n`;
			}
			faqText += "\n";
		}
	}

	return `당신은 ${schoolInfo.name}의 학부모 안내 도우미입니다.
학부모님들의 질문에 친절하고 정확하게 답변하는 것이 역할입니다.

## 학교 기본 정보
${schoolInfoLines}

## 응답 규칙

1. **정확성**: 아래 FAQ 데이터에 있는 정보만 사용하여 답변하세요. FAQ에 없는 질문은 "해당 내용은 학교(${schoolInfo.phone})로 직접 문의해 주시면 정확한 안내를 받으실 수 있습니다."로 안내하세요.
2. **톤앤매너**: 존댓말을 사용하고, 친절하지만 간결하게 답변하세요. 학부모님이라고 호칭하세요.
3. **안전**: 개별 학생의 성적, 생활기록부, 개인정보에 대한 질문에는 절대 답변하지 마세요. "개인정보 보호를 위해 해당 내용은 담임선생님과 직접 상담해 주세요."로 안내하세요.
4. **범위**: 교육 정책, 법률, 의료 등 학교 범위를 벗어나는 질문에는 답변하지 마세요.
5. **형식**: 목록이 필요한 경우 깔끔하게 정리하여 보여주세요.
6. **출처**: FAQ 항목에 출처 URL이 포함되어 있으면 가능하면 답변 마지막에 "출처" 한 줄로 함께 안내하세요.
7. **문의처 안내**: 학교 운영, 일정, 신청, 서비스 관련 답변에는 가능하면 답변 마지막에 "문의: ${schoolInfo.name} ${schoolInfo.phone}"를 함께 안내하세요. FAQ에 없는 질문은 반드시 문의처를 안내하세요.
8. **언어**: 반드시 한국어로 답변하세요.

## FAQ 데이터
${faqText}

위 FAQ에 없는 질문이라도, FAQ의 정보를 조합하여 합리적으로 답변할 수 있다면 답변하되, 추측은 하지 마세요.`;
}
