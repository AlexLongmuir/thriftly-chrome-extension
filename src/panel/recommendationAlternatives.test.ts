import { describe, expect, it } from "vitest";
import type { RecommendationCandidate } from "../shared/messages";
import { buildRecommendationAlternatives } from "./recommendationAlternatives";

describe("buildRecommendationAlternatives", () => {
  it("maps vector recommendation candidates, including stored image URLs", () => {
    const alternatives = buildRecommendationAlternatives([
      recommendationCandidate({
        title: "Better linen shirt",
        brand: "Arket",
        url: "https://example.com/better-shirt",
        image_url: "https://cdn.example.com/better-shirt.jpg",
        price_display: "£79",
        similarity: 0.83
      })
    ]);

    expect(alternatives).toEqual([
      expect.objectContaining({
        brand: "Arket",
        itemName: "Better linen shirt",
        price: "£79",
        matchLabel: "83% match",
        url: "https://example.com/better-shirt",
        thumbnail: "https://cdn.example.com/better-shirt.jpg"
      })
    ]);
  });

  it("does not require approved examples and falls back when image URLs are absent", () => {
    const alternatives = buildRecommendationAlternatives([
      recommendationCandidate({
        title: "Stored analysed product",
        brand: null,
        url: "https://example.com/stored-product",
        image_url: null,
        price_display: null,
        source: "analysed_product"
      })
    ]);

    expect(alternatives).toEqual([
      expect.objectContaining({
        brand: "Analysed product",
        price: "Price unavailable",
        thumbnail: null
      })
    ]);
  });
});

function recommendationCandidate(overrides: Partial<RecommendationCandidate>): RecommendationCandidate {
  return {
    id: "candidate-1",
    source: "approved_example",
    title: "Candidate",
    brand: "Example",
    url: "https://example.com/candidate",
    image_url: null,
    price_display: "£100",
    scores: {
      quality: 8,
      value: 7,
      durability: 7.5,
      aesthetic: 8.5,
      confidence: 0.8
    },
    recommendation: "worth_buying",
    match_reason: "same category and material",
    similarity: 0.75,
    ...overrides
  };
}
