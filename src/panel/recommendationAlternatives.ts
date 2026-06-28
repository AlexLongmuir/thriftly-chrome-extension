import type { RecommendationCandidate } from "../shared/messages";

export type AlternativeItem = {
  brand: string;
  itemName: string;
  price: string;
  matchLabel: string;
  rating: number;
  url: string;
  thumbnail: string | null;
};

export function buildRecommendationAlternatives(recommendations: RecommendationCandidate[]): AlternativeItem[] {
  return recommendations
    .filter((recommendation) => recommendation.title.trim() && recommendation.url.trim())
    .map((recommendation) => ({
      brand: recommendation.brand?.trim() || sourceLabel(recommendation.source),
      itemName: recommendation.title,
      price: recommendation.price_display?.trim() || "Price unavailable",
      matchLabel: `${Math.round(clamp(recommendation.similarity, 0, 1) * 100)}% match`,
      rating: scoreOutOf100(overallCandidateScore(recommendation)),
      url: recommendation.url,
      thumbnail: recommendation.image_url?.trim() || null
    }));
}

function overallCandidateScore(recommendation: RecommendationCandidate): number {
  const scores = recommendation.scores;
  return (scores.quality + scores.value + scores.durability + scores.aesthetic) / 4;
}

function scoreOutOf100(score: number): number {
  return Math.round(score * 10);
}

function sourceLabel(source: RecommendationCandidate["source"]): string {
  return source === "approved_example" ? "Approved example" : "Analysed product";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
