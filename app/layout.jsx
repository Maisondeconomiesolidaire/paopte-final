import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

export const metadata = {
  title: "ElevenLabs Papote",
  description: "Next.js starter for an ElevenLabs conversational agent",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="fr">
        <body>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
