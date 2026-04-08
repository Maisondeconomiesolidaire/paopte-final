import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  if (!q || q.trim().length < 3) {
    return NextResponse.json({ features: [] });
  }

  try {
    const response = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q.trim())}&limit=5&autocomplete=1`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return NextResponse.json({ features: [] }, { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json({ features: data.features || [] });
  } catch {
    return NextResponse.json({ features: [] }, { status: 200 });
  }
}
