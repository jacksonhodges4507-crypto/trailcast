import { NextResponse } from "next/server";
import { ask } from "@/lib/ask/answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 400;

async function handle(question: string, signal: AbortSignal): Promise<NextResponse> {
  const trimmed = question.trim();

  if (trimmed.length === 0) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }

  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` },
      { status: 400 },
    );
  }

  try {
    const answer = await ask({ question: trimmed, signal });
    return NextResponse.json(answer, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** POST /api/ask  { "question": "where should I ride saturday near park city?" } */
export async function POST(request: Request): Promise<NextResponse> {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  return handle(question, request.signal);
}

/** GET /api/ask?q=... — the same thing, for curl and for sharing links. */
export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return handle(q, request.signal);
}
