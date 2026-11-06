import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SCAN_ENABLED } from "@/lib/site";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Scanner from "@/components/scan/Scanner";

export const metadata: Metadata = {
  title: "Scan a manual | Bygga",
  description: "Photograph or upload any assembly manual and OpenRouter turns it into a step by step guide in 3D.",
};

export default function Page() {
  if (!SCAN_ENABLED) notFound();
  return (
    <div className="site">
      <SiteHeader />
      <main>
        <Scanner />
      </main>
      <SiteFooter />
    </div>
  );
}
