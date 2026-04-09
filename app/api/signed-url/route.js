import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(request) {
  await auth.protect();

  const { agentId } = await request.json();
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing ELEVENLABS_API_KEY in .env.local or .env" },
      { status: 500 }
    );
  }

  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "An agentId is required." }, { status: 400 });
  }

  try {
    const signedUrlResponse = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      {
        headers: {
          "xi-api-key": apiKey,
        },
        cache: "no-store",
      }
    );

    if (!signedUrlResponse.ok) {
      const signedUrlError = await signedUrlResponse.text();
      return NextResponse.json(
        {
          error: "Impossible de créer une session ElevenLabs.",
          details: signedUrlError,
        },
        { status: signedUrlResponse.status }
      );
    }

    const signedUrlData = await signedUrlResponse.json();

    return NextResponse.json({
      signedUrl: signedUrlData?.signed_url || null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not reach ElevenLabs.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
