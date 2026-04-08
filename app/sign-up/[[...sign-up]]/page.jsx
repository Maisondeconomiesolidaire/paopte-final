import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,rgba(184,126,177,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(0,127,112,0.16),transparent_24%),linear-gradient(180deg,#fffefd_0%,#f4fbf9_48%,#f7eef7_100%)] px-6 py-10">
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "#007f70",
            colorText: "#143c38",
            colorBackground: "#fffefd",
            colorInputBackground: "#ffffff",
            colorInputText: "#143c38",
          },
          elements: {
            card: "shadow-[0_24px_80px_rgba(0,127,112,0.08)] border border-white/80",
            footerActionLink: "text-[#b87eb1]",
          },
        }}
      />
    </main>
  );
}
