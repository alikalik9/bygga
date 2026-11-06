import { OG_SIZE, siteCard } from "@/lib/og/card";

export const alt = "Bygga: Build IKEA furniture, step by step. A KALLAX step drawn in the paper booklet style, next to the same step on Bygga. Powered by OpenRouter";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return siteCard();
}
