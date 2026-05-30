import { describe, expect, it } from "vitest";
import { handleQualityCheckPayload } from "../../api/quality-check";
import type { BackendPayload, ProductFieldName, ShopperSignal } from "../shared/messages";

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

  it("generates shopper-friendly good signs and watch-outs from product facts and missing evidence", async () => {
    const result = await handleQualityCheckPayload(createPayload({ imageUrls: [] }), {
      env: testEnv(),
      requestId: () => "shopper-signals"
    });

    const goodSigns = result.analysis?.verdict.good_signs ?? [];
    const watchOuts = result.analysis?.verdict.watch_outs ?? [];

    expect(result.analysis?.verdict.scores).toEqual(
      expect.objectContaining({
        quality: expect.any(Number),
        value: expect.any(Number),
        durability: expect.any(Number),
        aesthetic: expect.any(Number),
        confidence: expect.any(Number)
      })
    );
    expect(goodSigns.length).toBeGreaterThanOrEqual(3);
    expect(goodSigns.length).toBeLessThanOrEqual(5);
    expect(watchOuts.length).toBeGreaterThanOrEqual(3);
    expect(watchOuts.length).toBeLessThanOrEqual(5);
    expect(goodSigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Strong material choice",
          detail: expect.stringContaining("temperature regulation"),
          related_metric: "quality",
          strength: "high",
          confidence: "high",
          evidence_basis: expect.arrayContaining([
            expect.objectContaining({
              type: "product_fact",
              claim: expect.stringContaining("100% merino wool")
            })
          ])
        }),
        expect.objectContaining({
          label: "Fair value",
          detail: expect.stringContaining("At £120"),
          related_metric: "value",
          evidence_basis: expect.arrayContaining([
            expect.objectContaining({ type: "category_explanation" }),
            expect.objectContaining({ type: "benchmark_evidence" })
          ])
        })
      ])
    );
    expect(watchOuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Construction unclear",
          detail: expect.stringContaining("uncertainty"),
          related_metric: "durability",
          severity: "medium",
          evidence_basis: expect.arrayContaining([expect.objectContaining({ type: "missing_evidence" })])
        }),
        expect.objectContaining({
          label: "Quality evidence is thin",
          detail: expect.stringContaining("retailer facts"),
          evidence_basis: expect.arrayContaining([expect.objectContaining({ type: "missing_evidence" })])
        })
      ])
    );
    expectShopperSignalTitles([...goodSigns, ...watchOuts]);
    expect([...goodSigns, ...watchOuts].every((item) => sentenceCount(item.detail) <= 2)).toBe(true);
    expect([...goodSigns, ...watchOuts].every((item) => item.evidence_basis.length > 0)).toBe(true);
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
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "kamakura-wqgs04",
      fetcher: async (input) => {
        expect(String(input)).toBe("https://api.openai.com/v1/responses");
        return Response.json({
          output_text: JSON.stringify({
            external_sources_found: true,
            useful_sources_count: 2,
            external_evidence_quality: "moderate",
            external_score_impact: "medium",
            evidence: [
              {
                source_domain: "example.com",
                source_url: "https://example.com/kamakura-wqgs04-review",
                evidence_type: "exact_product",
                specificity: "exact_product",
                claim: "Kamakura WQGS04 review says the cotton oxford fabric feels substantial and the shirt is well made.",
                quote: "cotton oxford fabric feels substantial",
                relevance_score: 0.86,
                confidence: 0.72,
                affects: ["quality", "durability", "value"],
                reason_included: "Exact product review on an outside domain."
              },
              {
                source_domain: "example.com",
                source_url: "https://example.com/kamakura-shirts-review",
                evidence_type: "independent_review",
                specificity: "same_line",
                claim: "Kamakura Shirts dress shirts are praised for fabric quality, consistent sizing, and value.",
                quote: "praised for fabric quality, consistent sizing, and value",
                relevance_score: 0.78,
                confidence: 0.66,
                affects: ["quality", "value"],
                reason_included: "High-specificity independent review of the same shirt lane."
              }
            ],
            rejected_sources: []
          })
        });
      }
    });

    expect(result.analysis?.classification.brand).toBe("Kamakura Shirts");
    expect(result.analysis?.classification.material_description).toBe("Cotton 100%.");
    expect(result.analysis?.page_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claim: expect.stringContaining("Cotton 100%") }),
        expect.objectContaining({ claim: expect.stringContaining("Made in Japan") }),
        expect.objectContaining({ claim: expect.stringContaining("5.0/5 from 3 reviews") })
      ])
    );
    expect(result.analysis?.external_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: "example.com",
          source_url: "https://example.com/kamakura-wqgs04-review",
          evidence_type: "exact_product",
          source_type: "expert_guide",
          specificity: "exact_product",
          concrete_insight: expect.stringContaining("cotton oxford fabric"),
          theme: "fabric_weight"
        }),
        expect.objectContaining({
          source_domain: "example.com",
          evidence_type: "independent_review",
          source_type: "expert_guide",
          specificity: "same_brand_category",
          concrete_insight: expect.stringContaining("fabric quality")
        })
      ])
    );
    expect(result.analysis?.key_external_insights).toEqual(expect.arrayContaining([expect.stringContaining("cotton oxford fabric")]));
    expect(result.analysis?.external_coverage).toBe("moderate");
    expect(result.analysis?.useful_sources_count).toBe(2);
    expect(result.analysis?.external_score_impact).toBe("medium");
    expect(result.analysis?.public_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "expert_review",
          specificity: "exact_product",
          dimension: "quality",
          claim: expect.stringContaining("cotton oxford fabric")
        }),
        expect.objectContaining({
          sourceType: "expert_review",
          claim: expect.stringContaining("fabric quality")
        })
      ])
    );
    expect(result.analysis?.public_evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "official" })
      ])
    );
    expect(result.analysis?.verdict.evidence_score_effects).toEqual(expect.arrayContaining([expect.stringContaining("fabric")]));
    expect(result.analysis?.verdict.reasoning_flags).toContain("sizing_not_verified");
    expect(result.analysis?.verdict.reasoning_flags).not.toContain("material_composition_not_found");
    expect(result.analysis?.verdict.scores.quality).toBeGreaterThan(5.6);
    expect(result.analysis?.verdict.scores.value).toBeGreaterThan(5.6);
    expect(result.analysis?.verdict.good_signs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("cotton oxford fabric"),
          related_metric: "quality",
          evidence_basis: expect.arrayContaining([
            expect.objectContaining({
              type: "external_evidence",
              source: "example.com",
              claim: expect.stringContaining("Kamakura WQGS04 review")
            })
          ])
        })
      ])
    );
    expect(result.analysis?.verdict.watch_outs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Care details unclear",
          evidence_basis: expect.arrayContaining([expect.objectContaining({ type: "missing_evidence" })])
        })
      ])
    );
  });

  it("does not count UNIQLO first-party Oxford Shirt results as external evidence", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://www.uniqlo.com/uk/en/products/E462369-000/00";
    payload.page.title = "Oxford Shirt | UNIQLO";
    payload.page.visibleText = "Oxford Shirt. UNIQLO. 100% Cotton. Product ID: E462369-000.";
    payload.page.product.fields.title = field("Oxford Shirt");
    payload.page.product.fields.brand = field("UNIQLO");
    payload.page.product.fields.materials = field("100% Cotton");
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "UNIQLO",
      brand_tier: "high-street",
      material_family: "cotton",
      material_description: "100% Cotton.",
      quality_signals: ["stated on page: single-fibre natural material composition"],
      source_confidence_score: 0.86,
      source_confidence_label: "high"
    };

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "uniqlo-oxford-external-none",
      fetcher: async () =>
        Response.json({
          output_text: JSON.stringify({
            external_sources_found: true,
            useful_sources_count: 1,
            external_evidence_quality: "moderate",
            external_score_impact: "medium",
            evidence: [
              {
                source_domain: "uniqlo.com",
                source_url: "https://www.uniqlo.com/uk/en/products/E462369-000/00",
                evidence_type: "exact_product",
                specificity: "exact_product",
                claim: "UNIQLO Oxford Shirt Product ID E462369-000 is 100% cotton.",
                quote: "100% cotton",
                relevance_score: 0.9,
                confidence: 0.8,
                affects: ["quality", "value"],
                reason_included: "Model incorrectly returned same-retailer evidence."
              }
            ],
            rejected_sources: [
              {
                source_domain: "faq.uniqlo.com",
                source_url: "https://faq.uniqlo.com/uk/en/",
                evidence_type: "brand_reputation",
                specificity: "brand_general",
                claim: "Official UNIQLO product details and care information.",
                reason_rejected: "same-retailer source"
              }
            ]
          })
        })
    });

    expect(result.analysis?.page_evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_domain: "uniqlo.com", claim: expect.stringContaining("100% Cotton") })])
    );
    expect(result.analysis?.external_evidence).toEqual([]);
    expect(result.analysis?.benchmark_evidence).toEqual([]);
    expect(result.analysis?.public_evidence).toEqual([]);
    expect(result.analysis?.external_coverage).toBe("none");
    expect(result.analysis?.rejected_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: "uniqlo.com", reason_rejected: expect.stringContaining("same-retailer") })
      ])
    );
    expect(result.analysis?.verdict.reasoning_flags).toContain("external_evidence_none");
    expect(result.analysis?.verdict.scores.confidence).toBeLessThan(payload.classification.source_confidence_score);
  });

  it("uses the AI Evidence Agent and separates UNIQLO Oxford external and benchmark evidence", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://www.uniqlo.com/uk/en/products/E450259-000/01?colorDisplayCode=01&sizeDisplayCode=004";
    payload.page.title = "Men's Regular Fit Oxford Shirt | UNIQLO";
    payload.page.visibleText = "Men's Regular Fit Oxford Shirt. UNIQLO. Product ID: E450259-000. 100% Cotton. £29.90.";
    payload.page.product.fields.title = field("Men's Regular Fit Oxford Shirt");
    payload.page.product.fields.brand = field("UNIQLO");
    payload.page.product.fields.materials = field("100% Cotton");
    payload.page.product.fields.price = field("£29.90");
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "UNIQLO",
      brand_tier: "high-street",
      price: "£29.90",
      material_family: "cotton",
      material_description: "100% Cotton.",
      quality_signals: ["stated on page: single-fibre natural material composition"],
      source_confidence_score: 0.86,
      source_confidence_label: "high"
    };

    const fetchedUrls: string[] = [];
    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "uniqlo-oxford-ai-evidence-agent",
      fetcher: async (input) => {
        fetchedUrls.push(String(input));
        return Response.json({
          output_text: JSON.stringify({
            external_sources_found: true,
            useful_sources_count: 2,
            external_evidence_quality: "moderate",
            external_score_impact: "medium",
            evidence: [
              {
                source_domain: "reddit.com",
                source_url: "https://www.reddit.com/r/frugalmalefashion/comments/1c4cr7/uniqlo_oxford_shirts_sizing_impressions/",
                evidence_type: "independent_review",
                specificity: "same_line",
                claim: "Uniqlo's Slim Fit Oxford measurements and fit are discussed against other shirts.",
                quote: "Uniqlo Oxford Shirts: Sizing Impressions",
                relevance_score: 0.76,
                confidence: 0.62,
                affects: ["value", "confidence"],
                reason_included: "Independent discussion of the same UNIQLO Oxford shirt lane."
              },
              {
                source_domain: "insidehook.com",
                source_url: "https://www.insidehook.com/style/best-oxford-shirts-men",
                evidence_type: "category_benchmark",
                specificity: "category",
                claim: "The Affordable Option: Uniqlo Oxford Slim Fit Long-Sleeve Shirt, $40, compared with other Oxford shirts.",
                quote: "The Affordable Option",
                relevance_score: 0.72,
                confidence: 0.58,
                affects: ["value"],
                reason_included: "Relevant Oxford shirt category benchmark."
              },
              {
                source_domain: "uniqlo.com",
                source_url: "https://www.uniqlo.com/uk/en/products/E450259-000/01/reviews",
                evidence_type: "exact_product",
                specificity: "exact_product",
                claim: "View reviews for men's Regular Fit Oxford Shirt at UNIQLO UK.",
                quote: "UNIQLO UK reviews",
                relevance_score: 0.9,
                confidence: 0.8,
                affects: ["quality"],
                reason_included: "Same-retailer result should be rejected locally."
              }
            ],
            rejected_sources: []
          })
        });
      }
    });

    expect(fetchedUrls.every((url) => url === "https://api.openai.com/v1/responses")).toBe(true);
    expect(fetchedUrls.some((url) => url.includes("duckduckgo.com"))).toBe(false);
    expect(result.analysis?.external_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: "reddit.com",
          evidence_type: "independent_review",
          source_type: "reddit",
          theme: "fit",
          concrete_insight: expect.stringContaining("Slim Fit Oxford")
        })
      ])
    );
    expect(result.analysis?.external_evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source_domain: "uniqlo.com" })])
    );
    expect(result.analysis?.benchmark_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_domain: "insidehook.com",
          evidence_type: "category_benchmark",
          source_type: "editorial_review",
          claim: expect.stringContaining("Affordable Option")
        })
      ])
    );
    expect(result.analysis?.external_coverage).toBe("moderate");
    expect(result.analysis?.rejected_sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_domain: "uniqlo.com", reason_rejected: expect.stringContaining("same-retailer") })])
    );
  });

  it("keeps Reddit/forum evidence and synthesizes repeated shopper themes", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://www.uniqlo.com/uk/en/products/E450259-000/01";
    payload.page.title = "Men's Regular Fit Oxford Shirt | UNIQLO";
    payload.page.visibleText = "Men's Regular Fit Oxford Shirt. UNIQLO. Product ID: E450259-000. 100% Cotton. £29.90.";
    payload.page.product.fields.title = field("Men's Regular Fit Oxford Shirt");
    payload.page.product.fields.brand = field("UNIQLO");
    payload.page.product.fields.materials = field("100% Cotton");
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "UNIQLO",
      brand_tier: "high-street",
      price: "£29.90",
      material_family: "cotton",
      material_description: "100% Cotton."
    };

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "uniqlo-repeated-shopper-themes",
      fetcher: async () =>
        Response.json({
          output_text: JSON.stringify({
            external_sources_found: true,
            useful_sources_count: 3,
            external_evidence_quality: "moderate",
            external_score_impact: "low",
            evidence: [
              {
                source_domain: "reddit.com",
                source_url: "https://www.reddit.com/r/malefashionadvice/comments/example/uniqlo_oxford_shrinkage/",
                evidence_type: "independent_review",
                source_type: "reddit",
                specificity: "same_brand_category",
                concrete_insight: "UNIQLO Oxford shoppers repeatedly warn that fit can tighten after washing.",
                theme: "shrinkage",
                sentiment: "negative",
                quote_or_snippet: "fit can tighten after washing",
                applies_to_product: "partially",
                score_dimensions_affected: ["confidence"],
                claim: "UNIQLO Oxford shoppers repeatedly warn that fit can tighten after washing.",
                quote: "fit can tighten after washing",
                relevance_score: 0.76,
                confidence: 0.52,
                affects: ["confidence"],
                reason_included: "Same-brand-category Reddit pattern about Oxford shirt shrinkage."
              },
              {
                source_domain: "styleforum.net",
                source_url: "https://www.styleforum.net/threads/uniqlo-ocbd-fit-after-washing.123/",
                evidence_type: "independent_review",
                source_type: "forum",
                specificity: "same_brand_category",
                concrete_insight: "Forum users discuss UNIQLO OCBD sizing with shrinkage after washing as the main risk.",
                theme: "shrinkage",
                sentiment: "mixed",
                quote_or_snippet: "shrinkage after washing",
                applies_to_product: "partially",
                score_dimensions_affected: ["confidence"],
                claim: "Forum users discuss UNIQLO OCBD sizing with shrinkage after washing as the main risk.",
                quote: "shrinkage after washing",
                relevance_score: 0.72,
                confidence: 0.5,
                affects: ["confidence"],
                reason_included: "Forum discussion repeats the same washing-fit risk."
              },
              {
                source_domain: "gq.com",
                source_url: "https://www.gq.com/story/best-oxford-shirts",
                evidence_type: "category_benchmark",
                source_type: "editorial_review",
                specificity: "category_general",
                concrete_insight: "Oxford shirt buying guides treat shrinkage after washing as a benchmark fit concern.",
                theme: "shrinkage",
                sentiment: "neutral",
                quote_or_snippet: "shrinkage after washing",
                applies_to_product: "generally",
                score_dimensions_affected: ["value", "confidence"],
                claim: "Oxford shirt buying guides treat shrinkage after washing as a benchmark fit concern.",
                quote: "shrinkage after washing",
                relevance_score: 0.68,
                confidence: 0.56,
                affects: ["value", "confidence"],
                reason_included: "Editorial category benchmark defines a shopper criterion."
              }
            ],
            key_external_insights: [],
            repeated_themes: [],
            conflicting_evidence: [],
            evidence_gaps: [],
            cross_source_themes: [],
            rejected_sources: []
          })
        })
    });

    expect(result.analysis?.external_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: "reddit.com", source_type: "reddit", theme: "shrinkage" }),
        expect.objectContaining({ source_domain: "styleforum.net", source_type: "forum", theme: "shrinkage" })
      ])
    );
    expect(result.analysis?.repeated_themes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          theme: "shrinkage",
          source_count: 3,
          source_types: expect.arrayContaining(["reddit", "forum", "editorial_review"]),
          score_dimensions_affected: expect.arrayContaining(["confidence"])
        })
      ])
    );
    expect(result.analysis?.key_external_insights).toEqual(expect.arrayContaining([expect.stringContaining("shrinkage")]));
    expect(result.analysis?.verdict.watch_outs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "May shrink after washing",
          detail: expect.stringContaining("limited"),
          evidence_basis: expect.arrayContaining([expect.objectContaining({ type: "external_evidence", source: "reddit.com" })])
        })
      ])
    );
    expectShopperSignalTitles([...(result.analysis?.verdict.good_signs ?? []), ...(result.analysis?.verdict.watch_outs ?? [])]);
  });

  it("rejects generic weak sources and keeps them out of scoring", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://www.uniqlo.com/uk/en/products/E450259-000/01?colorDisplayCode=01&sizeDisplayCode=004";
    payload.page.title = "Men's Regular Fit Oxford Shirt | UNIQLO";
    payload.page.visibleText = "Men's Regular Fit Oxford Shirt. UNIQLO. Product ID: E450259-000. 100% Cotton. £29.90.";
    payload.page.product.fields.title = field("Men's Regular Fit Oxford Shirt");
    payload.page.product.fields.brand = field("UNIQLO");
    payload.page.product.fields.materials = field("100% Cotton");
    payload.page.product.fields.price = field("£29.90");
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "UNIQLO",
      brand_tier: "high-street",
      price: "£29.90",
      material_family: "cotton",
      material_description: "100% Cotton.",
      source_confidence_score: 0.86,
      source_confidence_label: "high"
    };

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "uniqlo-ai-evidence-agent-validation",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/responses") {
          return Response.json({
            output_text: JSON.stringify({
              external_sources_found: true,
              useful_sources_count: 3,
              external_evidence_quality: "moderate",
              external_score_impact: "high",
              evidence: [
                {
                  source_domain: "blankapparel.example",
                  source_url: "https://blankapparel.example/wholesale-t-shirts",
                  evidence_type: "category_benchmark",
                  specificity: "category",
                  claim: "Wholesale blank T-shirts can be bought in bulk at low prices.",
                  quote: "wholesale blank T-shirts",
                  relevance_score: 0.7,
                  confidence: 0.7,
                  affects: ["value"],
                  reason_included: "Model incorrectly returned unrelated wholesale T-shirts."
                },
                {
                  source_domain: "insidehook.com",
                  source_url: "https://www.insidehook.com/style/best-oxford-shirts-men",
                  evidence_type: "category_benchmark",
                  specificity: "category",
                  claim: "InsideHook lists Oxford shirts at several price points, including affordable high-street options.",
                  quote: "best Oxford shirts",
                  relevance_score: 0.69,
                  confidence: 0.56,
                  affects: ["value"],
                  reason_included: "Relevant Oxford shirt category price benchmark."
                }
              ],
              rejected_sources: []
            })
          });
        }
        return new Response("model unavailable", { status: 500 });
      }
    });

    expect(result.analysis?.external_evidence).toEqual([]);
    expect(result.analysis?.benchmark_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: "insidehook.com", evidence_type: "category_benchmark", source_type: "editorial_review" })
      ])
    );
    expect(result.analysis?.rejected_sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: "blankapparel.example", reason_rejected: expect.stringContaining("generic") })
      ])
    );
    expect(result.analysis?.external_coverage).toBe("limited");
    expect(result.analysis?.external_score_impact).toBe("low");
    expect(result.analysis?.verdict.evidence_score_effects).not.toEqual(
      expect.arrayContaining([expect.stringContaining("blank T-shirts")])
    );
  });

  it("keeps category-only AI evidence limited even when multiple relevant benchmark sources exist", async () => {
    const payload = createPayload({ imageUrls: [] });
    payload.page.url = "https://www.uniqlo.com/uk/en/products/E450259-000/01";
    payload.page.title = "Men's Regular Fit Oxford Shirt | UNIQLO";
    payload.page.visibleText = "Men's Regular Fit Oxford Shirt. UNIQLO. Product ID: E450259-000. 100% Cotton. £29.90.";
    payload.page.product.fields.title = field("Men's Regular Fit Oxford Shirt");
    payload.page.product.fields.brand = field("UNIQLO");
    payload.classification = {
      ...payload.classification,
      category: "shirt",
      brand: "UNIQLO",
      price: "£29.90",
      material_family: "cotton"
    };

    const result = await handleQualityCheckPayload(payload, {
      env: testEnv({ OPENAI_API_KEY: "test-openai-key", QUALITY_CHECK_PUBLIC_EVIDENCE_SEARCH: "enabled" }),
      requestId: () => "uniqlo-openai-annotations",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "https://api.openai.com/v1/responses") {
          return Response.json({
            output_text: JSON.stringify({
              external_sources_found: true,
              useful_sources_count: 2,
              external_evidence_quality: "moderate",
              external_score_impact: "medium",
              evidence: [
                {
                  source_domain: "gq.com",
                  source_url: "https://www.gq.com/story/best-white-button-down-shirt-for-men-style",
                  evidence_type: "category_benchmark",
                  specificity: "category",
                  claim: "GQ recommended budget-friendly Oxford/button-down shirt options in the same category lane.",
                  quote: "budget-friendly choice",
                  relevance_score: 0.68,
                  confidence: 0.55,
                  affects: ["value"],
                  reason_included: "Relevant category price benchmark, not exact-product proof."
                },
                {
                  source_domain: "esquire.com",
                  source_url: "https://www.esquire.com/style/mens-fashion/g1874/best-button-up-shirts-2014/",
                  evidence_type: "category_benchmark",
                  specificity: "category",
                  claim: "Esquire included Oxford/button-down shirts in a category roundup.",
                  quote: "best Oxford shirts roundup",
                  relevance_score: 0.66,
                  confidence: 0.54,
                  affects: ["value"],
                  reason_included: "Relevant category benchmark."
                },
                {
                  source_domain: "uniqlo.com",
                  source_url: "https://www.uniqlo.com/uk/en/products/E450259-000/01",
                  evidence_type: "exact_product",
                  specificity: "exact_product",
                  claim: "First-party source should be filtered.",
                  quote: "UNIQLO product page",
                  relevance_score: 0.9,
                  confidence: 0.8,
                  affects: ["quality"],
                  reason_included: "Same-retailer result should be rejected locally."
                }
              ],
              rejected_sources: []
            })
          });
        }
        return new Response("model unavailable", { status: 500 });
      }
    });

    expect(result.analysis?.external_evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source_domain: "uniqlo.com" })])
    );
    expect(result.analysis?.benchmark_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source_domain: "gq.com", evidence_type: "category_benchmark", source_type: "editorial_review" }),
        expect.objectContaining({ source_domain: "esquire.com", evidence_type: "category_benchmark", source_type: "editorial_review" })
      ])
    );
    expect(result.analysis?.external_coverage).toBe("limited");
    expect(result.analysis?.external_score_impact).toBe("low");
    expect(result.analysis?.rejected_sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ source_domain: "uniqlo.com", reason_rejected: expect.stringContaining("same-retailer") })])
    );
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

function expectShopperSignalTitles(items: ShopperSignal[]): void {
  const banned = /\b(?:stated|retrieved|source|category anchors?|known fibre|product fit|external source|metric)\b/i;
  for (const item of items) {
    const wordCount = item.label.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(2);
    expect(wordCount).toBeLessThanOrEqual(5);
    expect(item.label).not.toMatch(banned);
    if (item.label !== "Quality evidence is thin") {
      expect(item.label).not.toMatch(/\bevidence\b/i);
    }
  }
}

function sentenceCount(value: string): number {
  return value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.filter((item) => item.trim()).length ?? 0;
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
