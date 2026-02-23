import { GoogleGenerativeAI } from "@google/generative-ai";
import type { CallEndedData } from "@/types/call";
import type { QualificationResult } from "@/types/qualification";
import { QUESTION_CATEGORY_MAP, HIGH_SIGNAL_QUESTIONS } from "@/types/qualification";

export async function qualifyLead(
  callData: CallEndedData
): Promise<QualificationResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[gemini] No GEMINI_API_KEY set, skipping qualification");
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const qaSection = callData.question_pairs?.length > 0
    ? callData.question_pairs
        .map((qp) => {
          const category = QUESTION_CATEGORY_MAP[qp.question_id] || "other";
          const isHighSignal = (HIGH_SIGNAL_QUESTIONS as readonly string[]).includes(
            qp.question_id
          );
          return `[${qp.question_id}] (category: ${category}${isHighSignal ? ", HIGH SIGNAL" : ""})
Q: ${qp.question_text}
A: ${qp.user_said}`;
        })
        .join("\n\n")
    : callData.transcript
    ? `[FULL TRANSCRIPT]\n${callData.transcript.slice(0, 3000)}`
    : "(no Q&A data available)";

  const companyLabel = callData.client_name && callData.client_name !== "fwai"
    ? callData.client_name
    : "the company";

  const prompt = `You are an expert lead qualification analyst for ${companyLabel}.

Analyze this call transcript Q&A and classify the lead.

## Qualification Criteria
- **HOT**: Working professional with clear pain points OR business owner, shows urgency to act, ready to invest
- **WARM**: Interested in AI upskilling but no clear urgency or timeline
- **COLD**: Student with no income, just exploring, no real intent to invest

## Call Data
- Contact: ${callData.contact_name}
- Duration: ${callData.duration_seconds}s
- Questions completed: ${callData.questions_completed}/${callData.total_questions}
- Completion rate: ${Math.round(callData.completion_rate * 100)}%
- Interest level (from AI caller): ${callData.interest_level}
- Call summary: ${callData.call_summary}
- Objections raised: ${callData.objections_raised.length > 0 ? callData.objections_raised.join("; ") : "None"}

## Q&A Exchanges
${qaSection}

## Instructions
Respond with ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "level": "HOT" or "WARM" or "COLD",
  "confidence": <number 0-100>,
  "reasoning": "<2-3 sentence summary of why this qualification level>",
  "painPoints": ["<pain point 1>", "<pain point 2>"],
  "keyInsights": ["<insight 1>", "<insight 2>"],
  "recommendedAction": "<specific next step for sales team>",
  "objectionAnalysis": [
    {
      "objection": "<the objection>",
      "severity": "high" or "medium" or "low",
      "suggestedResponse": "<how to handle it>"
    }
  ]
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const cleaned = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleaned) as Omit<QualificationResult, "qualifiedAt">;

    if (!["HOT", "WARM", "COLD"].includes(parsed.level)) {
      throw new Error(`Invalid qualification level: ${parsed.level}`);
    }

    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));

    return {
      ...parsed,
      qualifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[gemini] Qualification failed:", error);
    return null;
  }
}
