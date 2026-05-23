import { describe, expect, it } from "vitest";
import { handleQualityCheckPayload } from "../../api/quality-check";
import type { BackendPayload, ProductFieldName } from "../shared/messages";

describe("quality-check API", () => {
  it("skips vision safely when product images are missing", async () => {
    const calls: string[] = [];
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: [] }), {
      env: testEnv(),
      requestId: () => "request-no-images",
      fetcher: async (input) => {
        calls.push(String(input));
        return new Response("{}");
      }
    });

    expect(calls).toEqual([]);
    expect(result).toMatchObject({
      requestId: "request-no-images",
      source: "backend",
      analysis: {
        status: "completed",
        visual_enrichment: {
          status: "skipped",
          image_count: 0,
          observations: [],
          warnings: expect.arrayContaining(["visual enrichment skipped: product images not found"])
        }
      }
    });
  });

  it("prevents image-only model claims about fabric quality, construction, authenticity, or durability", async () => {
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: ["https://cdn.example.com/product.png"] }), {
      env: testEnv(),
      requestId: () => "request-forbidden-claims",
      fetcher: async (input) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        visual_observations: [
                          {
                            observation: "The leather is genuine, durable, high quality and welted construction is visible",
                            confidence: "high",
                            evidence_type: "surface_detail",
                            should_affect_score: true
                          }
                        ],
                        visual_cues: [
                          {
                            cue: "The leather is genuine full-grain leather",
                            confidence: "high",
                            evidence_type: "texture_appearance",
                            image_limitations: []
                          }
                        ],
                        expert_inferences: [
                          {
                            inference: "The jacket is high quality and durable",
                            quality_dimension: "material_finish",
                            confidence: "high",
                            basis: "inferred_from_image",
                            why_it_matters: "Material finish affects ageing.",
                            caveat: "No caveat provided.",
                            score_dimension: "quality",
                            score_effect: "medium_positive"
                          }
                        ]
                      })
                    }
                  ]
                }
              }
            ]
          });
        }

        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" }
        });
      }
    });

    const observation = result.analysis?.visual_enrichment.observations[0];
    expect(observation).toEqual({
      observation: "Image-only claim removed because it asserted fabric quality, construction, authenticity, or durability.",
      confidence: "low",
      evidence_type: "surface_detail",
      should_affect_score: false
    });
    expect(result.analysis?.visual_enrichment.warnings).toContain(
      "visual observation downgraded: image-only claim exceeded Stage 5 limits"
    );
    expect(result.analysis?.visual_enrichment.warnings).toContain(
      "visual cue downgraded: image-only cue exceeded Stage 5 limits"
    );
    expect(result.analysis?.visual_enrichment.warnings).toContain(
      "expert visual inference downgraded: image-only claim lacked uncertainty"
    );
  });

  it("keeps cautious personal-shopper visual inferences with bounded score impact", async () => {
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: ["https://cdn.example.com/leather.png"] }), {
      env: testEnv(),
      requestId: () => "request-shopper-inference",
      fetcher: async (input) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        visual_cues: [
                          {
                            cue: "The surface appears very smooth and uniform with a slight plastic-like sheen.",
                            confidence: "medium",
                            evidence_type: "texture_appearance",
                            image_limitations: ["studio lighting", "no macro close-up"]
                          }
                        ],
                        expert_inferences: [
                          {
                            inference:
                              "This surface appearance can be consistent with corrected, coated, or heavily finished leather rather than more natural grain.",
                            quality_dimension: "material_finish",
                            confidence: "low",
                            basis: "inferred_from_image",
                            why_it_matters:
                              "Heavily finished leather can look uniform but may age less attractively than more natural grain.",
                            caveat: "Cannot verify leather grade from image alone.",
                            score_dimension: "quality",
                            score_effect: "medium_negative"
                          }
                        ],
                        missing_views: ["macro material close-up", "lining close-up"],
                        image_quality_limits: ["studio lighting may exaggerate sheen"]
                      })
                    }
                  ]
                }
              }
            ]
          });
        }

        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" }
        });
      }
    });

    expect(result.analysis?.visual_enrichment.visual_cues).toEqual([
      {
        cue: "The surface appears very smooth and uniform with a slight plastic-like sheen.",
        confidence: "medium",
        evidence_type: "texture_appearance",
        image_limitations: ["studio lighting", "no macro close-up"]
      }
    ]);
    expect(result.analysis?.visual_enrichment.expert_inferences).toEqual([
      {
        inference:
          "This surface appearance can be consistent with corrected, coated, or heavily finished leather rather than more natural grain.",
        quality_dimension: "material_finish",
        confidence: "low",
        basis: "inferred_from_image",
        why_it_matters: "Heavily finished leather can look uniform but may age less attractively than more natural grain.",
        caveat: "Cannot verify leather grade from image alone.",
        score_dimension: "quality",
        score_effect: "small_negative"
      }
    ]);
    expect(result.analysis?.visual_enrichment.missing_views).toEqual(["macro material close-up", "lining close-up"]);
    expect(result.analysis?.visual_enrichment.image_quality_limits).toEqual(["studio lighting may exaggerate sheen"]);
  });

  it("neutralises weak positive high-street blazer image claims", async () => {
    const payload = createPayload({ imageUrls: ["https://cdn.example.com/next-blazer.png"] });
    payload.classification.category = "outerwear";
    payload.classification.brand = "Next";
    payload.classification.brand_tier = "high-street";
    payload.classification.material_family = "blend";
    payload.classification.price = "£60";

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv(),
      requestId: () => "request-next-blazer",
      fetcher: async (input) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        expert_inferences: [
                          {
                            inference:
                              "The clean, crisp edges of the lapels and pocket flaps, along with the absence of visible puckering, suggest a good standard of construction finish for a high-street brand.",
                            quality_dimension: "construction_finish",
                            confidence: "medium",
                            basis: "inferred_from_image",
                            why_it_matters:
                              "Indicates attention to detail in manufacturing, contributing to the garment's overall perceived quality and aesthetic.",
                            caveat: "Based on product images only.",
                            score_dimension: "quality",
                            score_effect: "small_positive"
                          },
                          {
                            inference:
                              "The contrasting blue floral lining adds a distinct aesthetic refinement and suggests a thoughtful design choice, elevating the garment's visual appeal beyond a basic lining.",
                            quality_dimension: "aesthetic_refinement",
                            confidence: "high",
                            basis: "inferred_from_image",
                            why_it_matters:
                              "Enhances the perceived value and style, appealing to a buyer looking for unique details.",
                            caveat: "Based on product images only.",
                            score_dimension: "aesthetic",
                            score_effect: "medium_positive"
                          },
                          {
                            inference:
                              "The visible fabric texture and matte finish are consistent with a blend material, which may offer a balance of durability and comfort, typical for high-street outerwear.",
                            quality_dimension: "material_finish",
                            confidence: "medium",
                            basis: "inferred_from_image",
                            why_it_matters:
                              "Suggests the material choice aligns with the product category and brand tier, potentially offering practical benefits.",
                            caveat: "Based on product images only.",
                            score_dimension: "durability",
                            score_effect: "small_positive"
                          },
                          {
                            inference:
                              "The appearance of standard, functional buttons on the front and cuffs suggests a practical approach to hardware, consistent with a high-street brand tier.",
                            quality_dimension: "hardware_trim",
                            confidence: "medium",
                            basis: "inferred_from_image",
                            why_it_matters:
                              "Functional hardware is essential for garment utility; its appearance contributes to the overall finish.",
                            caveat: "Based on product images only.",
                            score_dimension: "quality",
                            score_effect: "small_positive"
                          }
                        ]
                      })
                    }
                  ]
                }
              }
            ]
          });
        }

        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" }
        });
      }
    });

    expect(result.analysis?.visual_enrichment.expert_inferences).toEqual([
      expect.objectContaining({
        inference:
          "Clean pressed edges or an absence of visible defects in studio product images are neutral; they do not establish construction quality without close-up seam, lining, or stitching evidence.",
        confidence: "low",
        score_effect: "none"
      }),
      expect.objectContaining({
        inference:
          "Visible lining, trim, buttons, or styling details are aesthetic cues only; they do not establish better construction, durability, or value from images alone.",
        confidence: "low",
        score_effect: "none"
      }),
      expect.objectContaining({
        inference:
          "Generic fabric texture or matte finish in a product image is not enough evidence to infer comfort, durability, or practical material benefits.",
        confidence: "low",
        score_effect: "none"
      }),
      expect.objectContaining({
        inference:
          "Clean pressed edges or an absence of visible defects in studio product images are neutral; they do not establish construction quality without close-up seam, lining, or stitching evidence.",
        confidence: "low",
        score_effect: "none"
      })
    ]);
    expect(result.analysis?.visual_enrichment.warnings).toContain(
      "expert visual inference neutralised: weak positive image cue is not reliable evidence"
    );
  });

  it("returns a stable structured backend response", async () => {
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: ["https://cdn.example.com/product.png"] }), {
      env: testEnv({
        QUALITY_CHECK_VISION_MODEL: "gemini-3.0-flash",
        QUALITY_CHECK_CORE_MODEL: "gpt-5.4-mini",
        QUALITY_CHECK_PREMIUM_FALLBACK_MODEL: "gpt-5.4",
        QUALITY_CHECK_EMBEDDING_MODEL: "text-embedding-3-small"
      }),
      requestId: () => "request-stable",
      fetcher: async (input) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        visual_observations: [
                          {
                            observation: "Navy colour and fine surface texture are visible in the image",
                            confidence: "medium",
                            evidence_type: "texture_appearance",
                            should_affect_score: true
                          }
                        ],
                        visual_cues: [
                          {
                            cue: "Fine, even surface texture is visible across the body.",
                            confidence: "medium",
                            evidence_type: "texture_appearance",
                            image_limitations: ["no macro close-up"]
                          }
                        ],
                        expert_inferences: [
                          {
                            inference: "The even surface may support a cleaner, more refined aesthetic presentation.",
                            quality_dimension: "aesthetic_refinement",
                            confidence: "medium",
                            basis: "inferred_from_image",
                            why_it_matters: "Surface regularity affects perceived polish in simple knitwear.",
                            caveat: "Cannot judge yarn quality or pilling resistance from the product image.",
                            score_dimension: "aesthetic",
                            score_effect: "small_positive"
                          }
                        ],
                        missing_views: ["seam close-up"],
                        image_quality_limits: ["studio lighting"]
                      })
                    }
                  ]
                }
              }
            ]
          });
        }

        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg" }
        });
      }
    });

    expect(result).toMatchObject({
      requestId: "request-stable",
      summary: 'Stage 6 verdict completed for "Merino Jumper": buy (7.3/10).',
      receivedUrl: "https://shop.example/products/merino-jumper",
      source: "backend",
      capturedTitle: "Merino Jumper",
      analysis: {
        stage: "stage_6",
        status: "completed",
        product: {
          title: "Merino Jumper",
          url: "https://shop.example/products/merino-jumper",
          page_state: "product_page",
          source_confidence_score: 0.86,
          source_confidence_label: "high"
        },
        classification: createPayload({ imageUrls: ["https://cdn.example.com/product.png"] }).classification,
        visual_enrichment: {
          status: "completed",
          model: "gemini-3.0-flash",
          image_count: 1,
          observations: [
            {
              observation: "Navy colour and fine surface texture are visible in the image",
              confidence: "medium",
              evidence_type: "texture_appearance",
              should_affect_score: true
            }
          ],
          visual_cues: [
            {
              cue: "Fine, even surface texture is visible across the body.",
              confidence: "medium",
              evidence_type: "texture_appearance",
              image_limitations: ["no macro close-up"]
            }
          ],
          expert_inferences: [
            {
              inference: "The even surface may support a cleaner, more refined aesthetic presentation.",
              quality_dimension: "aesthetic_refinement",
              confidence: "medium",
              basis: "inferred_from_image",
              why_it_matters: "Surface regularity affects perceived polish in simple knitwear.",
              caveat: "Cannot judge yarn quality or pilling resistance from the product image.",
              score_dimension: "aesthetic",
              score_effect: "small_positive"
            }
          ],
          missing_views: ["seam close-up"],
          image_quality_limits: ["studio lighting"],
          warnings: expect.arrayContaining([
            "vision observations are enrichment only",
            "expert visual inferences must be caveated and low/medium confidence unless directly visible",
            "do not assert fabric authenticity, exact construction method, or durability from images alone",
            "OPENAI_API_KEY is not configured; Stage 6 core analysis is disabled."
          ])
        },
        verdict: {
          overall_rating: 7.3,
          recommendation: "buy",
          scores: {
            quality: 7.8,
            value: 6.7,
            durability: 6.5,
            aesthetic: 7.6,
            confidence: 0.86
          },
          confidence_label: "high",
          matched_examples: expect.arrayContaining(["approved_merino_knit_mid_premium_001"]),
          model: "gpt-5.4-mini",
          model_status: "heuristic_fallback"
        },
        approved_examples: expect.arrayContaining([
          expect.objectContaining({
            id: "approved_merino_knit_mid_premium_001",
            similarity: 0.98
          })
        ]),
        model_config: expect.objectContaining({
          openai_configured: false
        })
      }
    });
  });

  it("keeps Stage 6 deterministic across repeat runs", async () => {
    const payload = createPayload({ imageUrls: [] });
    const results = await Promise.all([
      handleQualityCheckPayload(payload, { env: testEnv(), requestId: () => "run-1" }),
      handleQualityCheckPayload(payload, { env: testEnv(), requestId: () => "run-2" }),
      handleQualityCheckPayload(payload, { env: testEnv(), requestId: () => "run-3" })
    ]);

    expect(results.map((result) => result.analysis?.verdict.scores)).toEqual([
      results[0].analysis?.verdict.scores,
      results[0].analysis?.verdict.scores,
      results[0].analysis?.verdict.scores
    ]);
    expect(results.map((result) => result.analysis?.verdict.overall_rating)).toEqual([7.2, 7.2, 7.2]);
  });

  it("caps weak source data and returns not_enough_info instead of strong claims", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.product.sourceConfidenceScore = 0.28;
    payload.page.product.source_confidence_score = 0.28;
    payload.page.product.fields.materials = field(null);
    payload.classification.material_family = "unknown";
    payload.classification.source_confidence_score = 0.28;
    payload.classification.source_confidence_label = "low";
    payload.classification.quality_signals = [];
    payload.classification.quality_concerns = [
      "unknown: material composition not found",
      "unknown: weak source data limits classification confidence"
    ];

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv(),
      requestId: () => "weak-source"
    });

    expect(result.analysis?.verdict).toMatchObject({
      recommendation: "not_enough_info",
      confidence_label: "low",
      scores: expect.objectContaining({
        confidence: 0.28
      }),
      verdicts: {
        quality: expect.objectContaining({
          evidence_type: "unknown",
          confidence: "low"
        })
      }
    });
    expect(result.analysis?.verdict.reasoning_flags).toEqual(
      expect.arrayContaining(["material_composition_not_found", "weak_source_data"])
    );
    expect(result.analysis?.verdict.overall_rating).toBeLessThanOrEqual(5.2);
  });

  it("uses GPT-5.4-mini verdict output but clamps scores and confidence to Stage 6 guardrails", async () => {
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: [] }), {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key" }),
      requestId: () => "model-clamped",
      fetcher: async (input) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
        return Response.json({
          output_text: JSON.stringify({
            overall_rating: 9.9,
            recommendation: "strong_buy",
            recommendation_summary: "Model tried to overstate the item.",
            scores: {
              quality: 10,
              value: 10,
              durability: 10,
              aesthetic: 10,
              confidence: 1
            },
            confidence_label: "high",
            verdicts: {
              quality: { verdict: "Strong stated material signal.", confidence: "high", evidence_type: "stated_on_page" },
              value: { verdict: "Consistent with approved examples.", confidence: "high", evidence_type: "similar_approved_example" },
              durability: { verdict: "Will last for years.", confidence: "high", evidence_type: "general_material_knowledge" },
              aesthetic: { verdict: "Clean product image.", confidence: "high", evidence_type: "inferred_from_image" }
            },
            reasoning_flags: [],
            matched_examples: ["wrong_example"],
            evidence_score_effects: [],
            summary: "Overconfident model output."
          })
        });
      }
    });

    expect(result.analysis?.verdict).toMatchObject({
      model_status: "model_completed",
      model: "gpt-5.4-mini",
      scores: {
        quality: 8.5,
        value: 8,
        durability: 7.6,
        aesthetic: 8.8,
        confidence: 0.86
      },
      matched_examples: expect.arrayContaining(["approved_merino_knit_mid_premium_001"])
    });
    expect(result.analysis?.verdict.overall_rating).toBe(8.2);
  });

  it("creates a traceable public evidence pack and lifts Kamakura WQGS04 above the old under-score", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://kamakurashirts.com/products/wqgs04";
    payload.page.title = "Vintage Ivy Oxford Button Down Shirt WQGS04 | Kamakura Shirts";
    payload.page.visibleText = "Cotton 100%. Made in Japan. Shell buttons. Box pleat. Locker loop. Back collar button. 5.0 3 reviews.";
    payload.page.product.fields.title = field("Vintage Ivy Oxford Button Down Shirt WQGS04");
    payload.page.product.fields.brand = field("Kamakura Shirts");
    payload.page.product.fields.materials = field("Cotton 100%");
    payload.page.product.fields.origin = field("Made in Japan");
    payload.page.product.fields.construction = field("shell buttons; box pleat; locker loop; back collar button; pleated cuffs; front placket");
    payload.page.product.fields.onSiteRating = field("5.0");
    payload.page.product.fields.onSiteReviewCount = field("3");
    payload.page.product.fields.sizing = field(null);
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "Kamakura Shirts",
      brand_tier: "mid-premium",
      material_family: "cotton",
      material_description: "Cotton 100%.",
      construction_description: "shell buttons; box pleat; locker loop; back collar button; pleated cuffs; front placket.",
      quality_signals: [
        "stated on page: single-fibre natural material composition",
        "stated on page: Made in Japan",
        "stated on page: shell buttons",
        "stated on page: locker loop",
        "stated on page: back collar button",
        "stated on page: box pleat",
        "stated on page: 5.0/5 from 3 reviews"
      ],
      quality_concerns: ["unknown: care information not found"],
      source_confidence_score: 0.9,
      source_confidence_label: "high"
    };

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "kamakura-wqgs04",
      fetcher: async () =>
        new Response(
          `
            <a class="result__a" href="https://example.com/kamakura-wqgs04-review">Kamakura WQGS04 review</a>
            <a class="result__snippet">Kamakura WQGS04 review says the cotton oxford fabric feels substantial and the shirt is well made.</a>
            <a class="result__a" href="https://example.com/kamakura-shirts-review">Kamakura Shirts dress shirt review</a>
            <a class="result__snippet">Kamakura Shirts dress shirts are praised for fabric quality, consistent sizing, and value.</a>
          `,
          { headers: { "content-type": "text/html" } }
        )
    });

    expect(result.analysis?.classification.brand).toBe("Kamakura Shirts");
    expect(result.analysis?.classification.material_description).toBe("Cotton 100%.");
    expect(result.analysis?.public_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "official",
          specificity: "exact_product",
          dimension: "fabric",
          claim: expect.stringContaining("Cotton 100%")
        }),
        expect.objectContaining({
          sourceType: "official",
          specificity: "exact_product",
          claim: expect.stringContaining("Made in Japan")
        }),
        expect.objectContaining({
          sourceType: "official",
          specificity: "exact_product",
          claim: expect.stringContaining("5.0/5 from 3 reviews")
        }),
        expect.objectContaining({
          sourceType: "expert_review",
          specificity: "exact_product",
          dimension: "fabric",
          claim: expect.stringContaining("cotton oxford fabric")
        }),
        expect.objectContaining({
          sourceType: "expert_review",
          specificity: "same_brand_category",
          claim: expect.stringContaining("fabric quality")
        })
      ])
    );
    expect(result.analysis?.verdict.evidence_score_effects).toEqual(expect.arrayContaining([expect.stringContaining("fabric")]));
    expect(result.analysis?.verdict.reasoning_flags).toContain("sizing_not_verified");
    expect(result.analysis?.verdict.reasoning_flags).not.toContain("material_composition_not_found");
    expect(result.analysis?.verdict.scores.quality).toBeGreaterThan(5.6);
    expect(result.analysis?.verdict.scores.value).toBeGreaterThan(5.6);
  });
});

function testEnv(overrides: Record<string, string> = {}) {
  return {
    GEMINI_API_KEY: "test-gemini-key",
    OPENAI_API_KEY: "",
    QUALITY_CHECK_VISION_MODEL: "gemini-3.0-flash",
    QUALITY_CHECK_CORE_MODEL: "gpt-5.4-mini",
    QUALITY_CHECK_PREMIUM_FALLBACK_MODEL: "gpt-5.4",
    QUALITY_CHECK_EMBEDDING_MODEL: "text-embedding-3-small",
    QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "disabled",
    ...overrides
  };
}

function createPayload({ imageUrls }: { imageUrls: string[] }): BackendPayload {
  const fields = Object.fromEntries(FIELD_NAMES.map((name) => [name, field(null)])) as BackendPayload["page"]["product"]["fields"];
  fields.title = field("Merino Jumper");
  fields.brand = field("COS");
  fields.price = field("120");
  fields.currency = field("GBP");
  fields.materials = field("100% merino wool");

  return {
    page: {
      url: "https://shop.example/products/merino-jumper",
      title: "Merino Jumper",
      visibleText: "Merino Jumper 100% merino wool",
      meta: {},
      jsonLd: [],
      hydration: [],
      targetedText: [],
      product: {
        pageState: "product_page",
        page_state: "product_page",
        sourceMethod: "json_ld",
        source_method: "json_ld",
        sourceConfidenceScore: 0.86,
        source_confidence_score: 0.86,
        fields,
        imageUrls,
        image_urls: imageUrls,
        warnings: []
      },
      capturedAt: "2026-05-22T00:00:00.000Z"
    },
    classification: {
      category: "knitwear",
      brand: "COS",
      brand_tier: "mid-premium",
      price: "£120",
      material_family: "wool",
      primary_colour: "navy",
      style_tags: ["minimal", "smart casual"],
      use_case: "office casual",
      material_description: "100% merino wool.",
      construction_description: "Construction method not clearly stated.",
      quality_signals: ["stated on page: premium material term present"],
      quality_concerns: ["unknown: construction method not verified"],
      source_confidence_score: 0.86,
      source_confidence_label: "high",
      labelled_inferences: [{ field: "brand_tier", value: "mid-premium", basis: "inferred_from_brand" }]
    },
    visual_enrichment: {
      status: imageUrls.length > 0 ? "requested" : "skipped",
      model: "gemini-3.0-flash",
      fallback_model: "gpt-5.4",
      image_urls: imageUrls,
      observations: [],
      visual_cues: [],
      expert_inferences: [],
      missing_views: [],
      image_quality_limits: [],
      warnings: [
        "vision observations are enrichment only",
        "expert visual inferences must be caveated and low/medium confidence unless directly visible",
        "do not assert fabric authenticity, exact construction method, or durability from images alone"
      ],
      prompt: imageUrls.length > 0 ? "Return strict JSON with visual_observations." : null
    },
    extension: {
      stage: "stage_5",
      version: "0.5.0"
    }
  };
}

function field(value: string | string[] | null) {
  return {
    value,
    confidence: value ? 0.9 : 0,
    source: value ? ("json_ld" as const) : null,
    evidence: value ? ["test evidence"] : []
  };
}

const FIELD_NAMES: ProductFieldName[] = [
  "title",
  "brand",
  "price",
  "currency",
  "colour",
  "description",
  "materials",
  "care",
  "construction",
  "origin",
  "sizing",
  "onSiteRating",
  "onSiteReviewCount",
  "reviewClaims",
  "categoryBreadcrumbs"
];
