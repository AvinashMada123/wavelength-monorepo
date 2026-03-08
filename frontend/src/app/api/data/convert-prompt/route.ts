import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUidAndOrgFromToken } from "@/lib/db";

const CONVERT_PROMPT = `You are an expert at restructuring AI voice bot scripts into the NEPQ (Neuro-Emotional Persuasion Questions) framework format.

Your job: Take ANY raw bot prompt/script and convert it into our standardized format WITHOUT losing any information, context, steps, or nuance.

## OUTPUT FORMAT (follow exactly):

IDENTITY:
[Extract or infer: Name, role, company, background. Keep all details.]

HOW TO SPEAK:
[Extract or infer: Accent, phrases, fillers, tone, pace, rules about response length. Keep all voice/personality details.]

NEPQ Flow (one question, wait, next)
[Map ALL steps/questions into this format:]
PHASE_NAME: "Script text here" <wait> "Next script" <wait> If condition: "Response"
[Use these phase names: CONNECT, CONFIRM, SITUATION, PROBLEM, CONSEQUENCE, VALUE, REMINDER, CLOSE]
[For non-sales flows (onboarding, support), use descriptive phases: WELCOME, SETUP, GUIDE, VERIFY, COMPLETE]
[Each question/action that needs a user response MUST have <wait> after it]
[Conditional responses use: If yes/no/busy/condition: "response"]

# Objections (acknowledge, never argue, 1-2 sentences)
[Extract ALL objection handlers. Format: Objection: "Response"]

# Rules
[Extract ALL rules, constraints, do/don't rules]

# End Call
[Extract call ending behavior]

# Context
[List ALL variable placeholders used: {customer_name} {agent_name} etc.]

## CRITICAL RULES:
1. ZERO INFORMATION LOSS: Every single step, question, response, objection handler, rule, FAQ, and detail from the original MUST appear in the output. If the original has 10 steps, the output must have 10 steps. Count them.
2. NEVER invent new content. Only restructure what exists. Do NOT add steps, questions, or responses that are not in the original.
3. If the original has bilingual content (Hindi/English/Tamil/any language), preserve ALL language versions word-for-word.
4. Preserve ALL conditional logic (if/then/else branches) exactly as written.
5. Keep ALL specific details verbatim: names, prices, dates, URLs, phone numbers, product names, company names, workshop names, etc.
6. The format must be parseable: PHASE: "text" <wait> pattern.
7. If a step says [WAIT] or needs user confirmation, use <wait>.
8. Preserve the EXACT tone, personality, and speaking style from the original. Do not sanitize or formalize casual language.
9. If the original has FAQs, subroutines, or special sections, include them under appropriate headers.
10. Output ONLY the converted prompt. No explanation, no markdown fences.
11. VERIFY: Before outputting, mentally check that every piece of information from the original appears in your output. If anything is missing, add it back.`;

export async function POST(request: NextRequest) {
  try {
    const result = await getUidAndOrgFromToken(request);
    if (result instanceof NextResponse) return result;

    const { systemPrompt } = await request.json();
    if (!systemPrompt?.trim()) {
      return NextResponse.json(
        { error: "System prompt is required" },
        { status: 400 },
      );
    }

    const content = `${CONVERT_PROMPT}

## Original prompt to convert:
${systemPrompt.slice(0, 15000)}`;

    let convertedPrompt = "";
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || "";

    if (anthropicKey) {
      console.log("[convert-prompt] Using Anthropic Claude Haiku");
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          messages: [{ role: "user", content }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        convertedPrompt = data.content?.[0]?.text || "";
        console.log("[convert-prompt] Anthropic succeeded");
      } else {
        const errText = await res.text();
        console.error("[convert-prompt] Anthropic failed:", res.status, errText);
      }
    }

    if (!convertedPrompt && geminiKey) {
      console.log("[convert-prompt] Using Gemini 2.0 Flash");
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const genResult = await model.generateContent(content);
      convertedPrompt = genResult.response.text();
    }

    if (!convertedPrompt) {
      return NextResponse.json(
        { error: "No API key configured" },
        { status: 500 },
      );
    }

    // Clean up: remove markdown fences if LLM wrapped it
    convertedPrompt = convertedPrompt
      .replace(/^```(?:\w+)?\s*\n?/gm, "")
      .replace(/\n?\s*```$/gm, "")
      .trim();

    console.log(`[convert-prompt] Output: ${convertedPrompt.length} chars`);
    return NextResponse.json({ convertedPrompt });
  } catch (error) {
    console.error("[convert-prompt] Error:", error);
    return NextResponse.json(
      { error: "Failed to convert prompt" },
      { status: 500 },
    );
  }
}
