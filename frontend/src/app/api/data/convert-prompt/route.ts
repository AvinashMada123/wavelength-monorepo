import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getUidAndOrgFromToken } from "@/lib/db";

const CONVERT_PROMPT = `You are an expert at converting raw AI voice bot scripts into a structured, numbered-step format optimized for AI voice bots.

Your job: Take ANY raw bot prompt/script and restructure it into our standardized format WITHOUT losing ANY information.

## OUTPUT FORMAT (follow exactly):

IDENTITY:
[Name, role, company, background. Extract from original or infer.]

HOW TO SPEAK:
[Tone, pace, accent, personality, response length rules. Keep all voice/personality details from original.]

CONVERSATION FLOW:
[Convert the ENTIRE script into numbered steps. EVERY action, question, explanation, and instruction becomes its own step.]

Step 1: "Exact script text the bot should say" <wait for response>
  - If yes: proceed to Step 2
  - If no/busy: "Handle accordingly"

Step 2: "Next thing the bot says" <wait for response>

Step 3: "Bot explains something" (no wait needed — bot continues to Step 4)

Step 4: "Bot asks a question" <wait for response>
  - If confirmed: proceed to Step 5
  - If not done yet: "Guide them through it, then proceed"

[Continue numbering ALL steps sequentially...]

RULES:
- Each step = ONE action: either ask a question, give an instruction, or explain something
- Steps that need user response: add <wait for response> after the text
- Steps that are pure explanation: bot says it and continues to the next step automatically
- Long explanations should be SPLIT into multiple steps (one concept per step)
- Conditional branches: show as "If X: do Y" under the step
- EVERY piece of information from the original MUST have its own step

# Objections
[Extract ALL objection handlers. Format: "If user says X" → "Response"]

# End Call
[How to end the call gracefully]

# Variables
[List all placeholders: {customer_name}, {agent_name}, etc.]

## CRITICAL RULES:
1. ZERO INFORMATION LOSS: Count every distinct action/question/explanation in the original. Your output must have AT LEAST that many steps. If the original covers 15 topics, you need 15+ steps.
2. NEVER combine multiple topics into one step. Split them. More steps = better. The bot follows steps one-by-one, so each step must be focused.
3. NEVER invent new content. Only restructure what exists.
4. If the original has bilingual content (Hindi/English/Tamil/any language), preserve ALL language versions word-for-word.
5. Preserve ALL conditional logic (if/then/else branches) exactly as written.
6. Keep ALL specific details VERBATIM: names, prices, dates, URLs, phone numbers, product names, company names, course names, group names, times, codes.
7. Preserve the EXACT tone and speaking style from the original. Do not formalize casual language.
8. If the original has FAQs, subroutines, or special sections, include them under appropriate headers.
9. Output ONLY the converted prompt. No explanation, no markdown fences.
10. VERIFY: Before outputting, go through the original line by line and confirm every piece of information appears in your output. If ANYTHING is missing, add it as a new step.`;

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
