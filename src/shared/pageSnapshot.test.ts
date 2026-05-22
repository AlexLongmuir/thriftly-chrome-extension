import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { classifyProductEvidence } from "./classification";
import {
  collectImageUrls,
  collectJsonLd,
  collectMetaTags,
  collectTargetedText,
  createBackendPayload,
  createPageSnapshot,
  enrichProductWithEvidenceSnippets,
  extractProductData,
  normaliseWhitespace
} from "./pageSnapshot";
import { createPageSnapshotWithRetailerFallbacks } from "./retailerFallbacks";
import { createVisualEnrichment, sanitiseExpertVisualInferences, sanitiseVisualObservations } from "./visualEnrichment";

describe("page snapshot helpers", () => {
  it("normalises whitespace", () => {
    expect(normaliseWhitespace("  Wool   jumper\n\nwith   rib trim  ")).toBe("Wool jumper with rib trim");
  });

  it("collects named, property, and itemprop meta tags once", () => {
    const dom = new JSDOM(`
      <meta property="og:title" content="Merino Jumper">
      <meta name="description" content="Soft knitwear">
      <meta itemprop="brand" content="COS">
      <meta property="og:title" content="Duplicate">
    `);

    expect(collectMetaTags(dom.window.document)).toEqual({
      "og:title": "Merino Jumper",
      description: "Soft knitwear",
      brand: "COS"
    });
  });

  it("prioritises JSON-LD Product data over weaker page text", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Generic Product Page</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Extra Fine Merino Jumper",
            "brand": {"@type": "Brand", "name": "ARKET"},
            "description": "Crew-neck jumper knitted from extra fine merino wool.",
            "material": "100% merino wool",
            "image": ["https://cdn.example.com/jumper-front.jpg"],
            "offers": {"@type": "Offer", "price": "89", "priceCurrency": "GBP"}
          }
        </script>
        <meta property="og:title" content="Fallback Title">
        <body>
          <main>
            <h1>Fallback Title</h1>
            <section>Composition Cotton blend</section>
            <img src="/jumper-side.jpg" width="900" height="1200" alt="Extra Fine Merino Jumper">
          </main>
        </body>
      `,
      { url: "https://www.example.com/products/merino-jumper" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.page_state).toBe("product_page");
    expect(product.sourceMethod).toBe("json_ld");
    expect(product.source_method).toBe("json_ld");
    expect(product.fields.title.value).toBe("Extra Fine Merino Jumper");
    expect(product.fields.title.source).toBe("json_ld");
    expect(product.fields.brand.value).toBe("ARKET");
    expect(product.fields.materials.value).toBe("100% merino wool");
    expect(product.fields.price.value).toBe("89");
    expect(product.fields.currency.value).toBe("GBP");
    expect(product.sourceConfidenceScore).toBeGreaterThan(0.6);
    expect(product.source_confidence_score).toBe(product.sourceConfidenceScore);
    expect(product.imageUrls).toContain("https://cdn.example.com/jumper-front.jpg");
    expect(product.image_urls).toContain("https://cdn.example.com/jumper-front.jpg");
    expect(product.imageUrls).toContain("https://www.example.com/jumper-side.jpg");
  });

  it("extracts colour as its own field instead of folding it into care", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Cashmere Sweater</title>
        <body>
          <main>
            <h1>Brushed Cashmere Sweater</h1>
            <section class="product-details">Care: Hand wash or dry clean Designer colour: Ebony</section>
            <section class="product-details">Editor's Notes: This sweater is brushed for an especially soft handle.</section>
            <section class="product-details">Composition: 100% cashmere.</section>
          </main>
        </body>
      `,
      { url: "https://www.mrporter.com/en-gb/mens/product/mr-p/clothing/crew-necks/brushed-cashmere-sweater/46376663162905192" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.brand.value).toBe("MR P.");
    expect(product.fields.care.value).toBe("Hand wash or dry clean");
    expect(product.fields.colour.value).toBe("Ebony");
    expect(product.fields.description.value).toContain("Editor's Notes");
  });

  it("does not use size selector and checkout copy as sizing evidence", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Men's 100% Merino Crew Neck Jumper | UNIQLO UK</title>
        <body>
          <main>
            <h1>100% Merino Crew Neck Jumper</h1>
            <section>
              Colour: 69 NAVY Size: Men S XXS XS S M L XL XXL 3XL
              Sizing £34.90 4.6 (800) 1 In stock ADD TO CART ADD TO WISHLIST
              FREE NEXT DAY DELIVERY with Click & Collect
            </section>
            <section>Composition: 100% Wool.</section>
          </main>
        </body>
      `,
      { url: "https://www.uniqlo.com/uk/en/products/E450535-000/00?colorDisplayCode=69&sizeDisplayCode=003" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.colour.value).toBe("NAVY");
    expect(product.fields.sizing.value).toBeNull();
  });

  it("extracts targeted material and care evidence without nav/footer pollution", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Cotton Oxford Shirt</title>
        <body>
          <nav>Women Men Brands New In Sale</nav>
          <main>
            <h1>Cotton Oxford Shirt</h1>
            <section class="product-details">
              Product details.
              Materials: 100% organic cotton.
              Care: Machine wash at 30C.
              Made in Portugal.
            </section>
            <section class="promo">Free delivery over £50. Newsletter signup.</section>
          </main>
          <footer>Help Returns Careers</footer>
        </body>
      `,
      { url: "https://shop.example/products/oxford-shirt" }
    );

    const snippets = collectTargetedText(dom.window.document);
    const product = extractProductData(dom.window.document, dom.window.location);

    expect(snippets.map((snippet) => snippet.text).join(" ")).not.toContain("Women Men Brands");
    expect(product.fields.materials.value).toContain("100% organic cotton");
    expect(product.fields.care.value).toContain("Machine wash");
    expect(product.fields.origin.value).toContain("Made in Portugal");
  });

  it("extracts category breadcrumbs without using breadcrumb labels as brand", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Relaxed Linen Shirt</title>
        <meta property="og:title" content="Relaxed Linen Shirt">
        <meta property="product:brand" content="Women">
        <body>
          <nav aria-label="Breadcrumb">
            <a>Home</a>
            <a>Women</a>
            <a>Clothing</a>
            <a>Shirts</a>
          </nav>
          <main>
            <h1>Relaxed Linen Shirt</h1>
            <section class="product-details">Materials: 100% linen.</section>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/linen-shirt" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.fields.brand.value).toBeNull();
    expect(product.fields.categoryBreadcrumbs.value).toEqual(["Shirts"]);
  });

  it("uses hydration blobs ahead of targeted DOM when structured Product data is absent", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Hydrated product</title>
        <body>
          <main>
            <h1>Hydrated product</h1>
            <script id="__NEXT_DATA__">
              {"props":{"pageProps":{"product":{"name":"Cashmere Cardigan","brand":"COS","price":135,"currency":"GBP","composition":"100% cashmere","careInstructions":"Hand wash only"}}}}
            </script>
            <section class="product-details">Materials: Cotton blend.</section>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/cashmere-cardigan" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.fields.title.value).toBe("Cashmere Cardigan");
    expect(product.fields.title.source).toBe("hydration_blob");
    expect(product.fields.materials.value).toBe("100% cashmere");
    expect(product.fields.materials.source).toBe("hydration_blob");
    expect(product.fields.price.value).toBe("135");
  });

  it("deep-parses product hydration objects for composition, care, sizing, origin, and category", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Hydrated retailer product</title>
        <body>
          <main>
            <script id="__NEXT_DATA__" type="application/json">
              {
                "props": {
                  "pageProps": {
                    "blocks": [
                      {
                        "product": {
                          "defaultName": "Heavy Knit Wool Blend Jumper",
                          "brandName": "ARKET",
                          "priceAsNumber": 77,
                          "currency": "GBP",
                          "description": "Chunky jumper knitted in a plain stitch with ribbed trims.",
                          "var_material_composition_desc": "[{\\"type\\":null,\\"materials\\":[{\\"material\\":\\"Wool\\",\\"percentage\\":65},{\\"material\\":\\"Polyamide\\",\\"percentage\\":35}]}]",
                          "var_care_instruction": ["Dry clean", "Hand wash cold", "Dry flat"],
                          "pr_fit": "Oversized",
                          "pr_garment_length": "Regular length",
                          "pr_product_type_name": "Jumper",
                          "categoryName": ["men", "knitwear"],
                          "var_compliance_details_key": "{\\"frenchAntiWasteLawForaCircularEconomy\\":{\\"traceability\\":{\\"articleCountryOfProduction\\":[{\\"value\\":\\"Myanmar\\"}]}}}"
                        }
                      }
                    ]
                  }
                }
              }
            </script>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/hydrated" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.fields.title.value).toBe("Heavy Knit Wool Blend Jumper");
    expect(product.fields.brand.value).toBe("ARKET");
    expect(product.fields.price.value).toBe("77");
    expect(product.fields.currency.value).toBe("GBP");
    expect(product.fields.materials.value).toBe("Wool 65%, Polyamide 35%");
    expect(product.fields.care.value).toBe("Dry clean, Hand wash cold, Dry flat");
    expect(product.fields.construction.value).toContain("plain stitch");
    expect(product.fields.origin.value).toBe("Made in Myanmar");
    expect(product.fields.sizing.value).toEqual(["Oversized", "Regular length"]);
    expect(product.fields.categoryBreadcrumbs.value).toEqual(["men", "knitwear", "Jumper"]);
  });

  it("extracts DOM price and currency from targeted price elements", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Leather Jacket</title>
        <body>
          <main>
            <h1>Leather Jacket</h1>
            <p class="product-price">Was £499, is £399.00</p>
            <section class="product-details">Fabric & care: Shell: 100% sheep leather. Specialist leather dry clean only.</section>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/leather-jacket" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.fields.price.value).toBe("399.00");
    expect(product.fields.currency.value).toBe("GBP");
    expect(product.fields.materials.value).toContain("100% sheep leather");
    expect(product.fields.care.value).toContain("Specialist leather dry clean only");
  });

  it("prefers discounted targeted DOM price over stale structured product price", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Slim Fit Round-necked T-shirt</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Slim Fit Round-necked T-shirt",
            "brand": {"@type": "Brand", "name": "H&M"},
            "description": "Slim-fit T-shirt in soft cotton jersey.",
            "offers": {"@type": "Offer", "price": "6.99", "priceCurrency": "GBP"}
          }
        </script>
        <body>
          <main>
            <h1>Slim Fit Round-necked T-shirt</h1>
            <div class="price parbase product-item-price">
              <span class="old-price">£6.99</span>
              <span class="sale-price">£3.99</span>
            </div>
            <section class="product-details">Composition: 100% cotton.</section>
          </main>
        </body>
      `,
      { url: "https://www2.hm.com/en_gb/productpage.0570002002.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.price.value).toBe("3.99");
    expect(product.fields.price.source).toBe("dom_targeted");
    expect(product.fields.currency.value).toBe("GBP");
  });

  it("uses the discounted H&M price for the exact reported product URL", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Slim Fit Round-necked T-shirt</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Slim Fit Round-necked T-shirt",
            "brand": {"@type": "Brand", "name": "H&M"},
            "description": "Slim-fit T-shirt in soft cotton jersey.",
            "offers": {"@type": "Offer", "price": "5.95", "priceCurrency": "GBP"}
          }
        </script>
        <body>
          <main>
            <h1>Slim Fit Round-necked T-shirt</h1>
            <div class="price parbase product-item-price">
              <span class="price-value">£3.99</span><span class="price-value">£5.95</span>
              <span>Sale price in effect for 90+ days</span>
            </div>
            <section class="product-details">Composition: 100% cotton.</section>
          </main>
        </body>
      `,
      { url: "https://www2.hm.com/en_gb/productpage.0570002002.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.price.value).toBe("3.99");
    expect(product.fields.price.source).toBe("dom_targeted");
    expect(product.fields.currency.value).toBe("GBP");
  });

  it("prefers current and sale prices over generic price keys in hydration blobs", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Sale product</title>
        <body>
          <main>
            <h1>Sale product</h1>
            <script id="__NEXT_DATA__">
              {"props":{"pageProps":{"product":{"name":"Cotton Overshirt","brand":"Example","price":"89","currentPrice":"59","salePrice":"49","currency":"GBP","composition":"100% cotton"}}}}
            </script>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/cotton-overshirt" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.price.value).toBe("59");
  });

  it("rejects zero price candidates as missing product price", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>T-shirt</title>
        <meta property="product:price:amount" content="0">
        <body>
          <main>
            <h1>T-shirt</h1>
            <section>Composition: 100% cotton.</section>
          </main>
        </body>
      `,
      { url: "https://www2.hm.com/en_gb/productpage.0570002002.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.price.value).toBeNull();
  });

  it("promotes material, care, and construction evidence from structured descriptions", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Leather Trainers</title>
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Leather Trainers",
            "brand": "Autograph",
            "description": "These genuine leather trainers have smooth cupsoles. Machine washable lining is not stated.",
            "offers": {"price": "75", "priceCurrency": "GBP"}
          }
        </script>
        <body><main><h1>Leather Trainers</h1></main></body>
      `,
      { url: "https://www.marksandspencer.com/leather-trainers/p/clp60720372" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.materials.value).toBe("genuine leather");
    expect(product.fields.materials.source).toBe("json_ld");
    expect(product.fields.care.value).toContain("Machine washable");
    expect(product.fields.construction.value).toContain("cupsoles");
  });

  it("classifies challenge and failover copy instead of analysing it as product content", () => {
    const challenge = new JSDOM("<title>Just a moment...</title><body>Checking your browser before accessing the site.</body>", {
      url: "https://www.allsaints.com/eu/men/leathers/leather-jackets/example.html"
    });
    const failover = new JSDOM("<title>Hang Tight! Routing to checkout...</title><body>Hang Tight! Routing to checkout...</body>", {
      url: "https://www.patagonia.com/product/example.html"
    });

    expect(extractProductData(challenge.window.document, challenge.window.location).pageState).toBe("blocked_or_unavailable");
    expect(extractProductData(failover.window.document, failover.window.location).pageState).toBe("site_failover");
  });

  it("drops known bogus hydration currency values", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Hydrated product</title>
        <body>
          <main>
            <script id="__NEXT_DATA__">{"product":{"name":"Leather Trainer","price":75,"currency":"ALL","description":"Genuine leather trainer."}}</script>
          </main>
        </body>
      `,
      { url: "https://www.marksandspencer.com/leather-trainers/p/clp60720372" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.currency.value).toBeNull();
  });

  it("classifies blocked pages instead of extracting a product from noisy text", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Access denied</title>
        <body>
          <main>
            <h1>Access denied</h1>
            <p>Request blocked. Please enable cookies to continue.</p>
            <section class="product-details">Materials: 100% cotton.</section>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/blocked" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("blocked_or_unavailable");
    expect(product.sourceConfidenceScore).toBe(0);
  });

  it("does not pretend non-product pages are products", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>About us</title>
        <body>
          <main>
            <h1>About us</h1>
            <p>We design clothes and publish journal articles about fabric care.</p>
          </main>
        </body>
      `,
      { url: "https://shop.example/about" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("not_product_page");
    expect(product.sourceConfidenceScore).toBe(0);
    expect(product.warnings).toContain("page classified as not_product_page");
  });

  it("classifies thin pages before analysis", () => {
    const dom = new JSDOM("<!doctype html><body>Loading</body>", {
      url: "https://shop.example/products/loading"
    });

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("thin_page");
    expect(product.sourceConfidenceScore).toBe(0);
    expect(product.fields.title.value).toBeNull();
    expect(product.warnings).toContain("page classified as thin_page");
  });

  it("classifies unsupported browser/document locations before analysis", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Local product</title>
        <body><main><h1>Local product</h1><section>Composition: 100% cotton. £30</section></main></body>
      `,
      { url: "file:///Users/alex/product.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("unsupported_page");
    expect(product.sourceConfidenceScore).toBe(0);
    expect(product.fields.materials.value).toBeNull();
    expect(product.warnings).toContain("page classified as unsupported_page");
  });

  it("keeps visible-text-only product evidence low confidence instead of dropping the product page", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Plain Cotton Shirt</title>
        <body>
          <h1>Plain Cotton Shirt</h1>
          <p>£39.50</p>
        </body>
      `,
      { url: "https://shop.example/products/plain-cotton-shirt" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.sourceMethod).toBe("visible_text_fallback");
    expect(product.sourceConfidenceScore).toBeLessThan(0.3);
    expect(product.fields.title).toMatchObject({
      value: "Plain Cotton Shirt",
      confidence: 0.48,
      source: "visible_text_fallback"
    });
    expect(product.fields.price).toMatchObject({
      value: "39.50",
      confidence: 0.44,
      source: "visible_text_fallback"
    });
    expect(product.fields.currency.value).toBe("GBP");
    expect(product.warnings).toContain("low-confidence title from visible_text_fallback");
    expect(product.warnings).toContain("low-confidence price from visible_text_fallback");
  });

  it("does not classify generic pages as products just because visible text contains a price", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Shipping information</title>
        <body><h1>Shipping information</h1><p>Express delivery costs £4.99 for UK orders.</p></body>
      `,
      { url: "https://shop.example/help/shipping" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("not_product_page");
    expect(product.fields.price.value).toBeNull();
    expect(product.sourceConfidenceScore).toBe(0);
  });

  it("rejects nav/category labels as brands across confidence calculation", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Cashmere jumper</title>
        <meta property="product:brand" content="New In">
        <script type="application/ld+json">{
          "@type":"Product",
          "name":"Cashmere jumper",
          "description":"100% cashmere jumper.",
          "offers":{"price":"120","priceCurrency":"GBP"}
        }</script>
        <body><main><h1>Cashmere jumper</h1></main></body>
      `,
      { url: "https://shop.example/products/cashmere-jumper" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("product_page");
    expect(product.fields.brand.value).toBeNull();
    expect(product.warnings).toContain("brand not found");
  });

  it("suppresses polluted fields when an error page contains product-like words", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Campaign page</title>
        <body>
          <main>
            <p>Something went wrong.</p>
            <section>Description: A seasonal campaign mentions care, wool and construction.</section>
            <section>Care: Dry clean only.</section>
          </main>
        </body>
      `,
      { url: "https://www.arket.com/en_gbp/men/knitwear/product.fine-knit-merino-jumper-black.0490418001.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.pageState).toBe("error_page");
    expect(product.fields.description.value).toBeNull();
    expect(product.fields.care.value).toBeNull();
    expect(product.fields.materials.value).toBeNull();
  });

  it("enriches product fields from interactive disclosure snippets", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Miller Leather Jacket</title>
        <script type="application/ld+json">{
          "@type":"Product",
          "name":"Miller Leather Jacket",
          "brand":"AllSaints",
          "description":"Shop the Miller Leather Jacket in Black at ALLSAINTS from our collection of Leather Jackets.",
          "offers":{"price":"399","priceCurrency":"GBP"}
        }</script>
        <body><main><h1>Miller Leather Jacket</h1></main></body>
      `,
      { url: "https://www.allsaints.com/eu/men/leathers/leather-jackets/miller-leather-jacket/M009LA-5.html" }
    );
    const snapshot = createPageSnapshot(dom.window.document, dom.window.location);

    const enriched = enrichProductWithEvidenceSnippets(snapshot, [
      {
        source: "dom_targeted",
        label: "interactive disclosure: Product details",
        text:
          "Product details Miller Leather Jacket Vintage motorcycle jackets have always inspired our leathers. The Miller Jacket is no exception - crafted from premium leather with antique brass finish hardware and simple detailing. Zip closure. Full collar. Long sleeves. Fabric & Care: Shell: 100% sheep leather. Lining: 100% recycled polyester. Specialist leather dry clean only. Made in: India."
      }
    ]);

    expect(enriched.product.fields.description.value).toContain("Vintage motorcycle jackets");
    expect(enriched.product.fields.colour.value).toBe("Black");
    expect(enriched.product.fields.materials.value).toContain("Shell: 100% sheep leather");
    expect(enriched.product.fields.care.value).toContain("Specialist leather dry clean only");
    expect(enriched.product.fields.origin.value).toBe("Made in India");
  });

  it("adds complementary drawer facts without replacing stronger structured field data", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Leather Jacket</title>
        <script type="application/ld+json">{
          "@type":"Product",
          "name":"Leather Jacket",
          "brand":"Example",
          "material":"genuine leather",
          "offers":{"price":"399","priceCurrency":"GBP"}
        }</script>
        <body><main><h1>Leather Jacket</h1></main></body>
      `,
      { url: "https://shop.example/products/leather-jacket" }
    );
    const snapshot = createPageSnapshot(dom.window.document, dom.window.location);

    const enriched = enrichProductWithEvidenceSnippets(snapshot, [
      {
        source: "dom_targeted",
        label: "interactive disclosure: Fabric & Care",
        text: "Fabric & Care Shell: 100% sheep leather. Lining: 100% recycled polyester. Specialist leather dry clean only."
      }
    ]);

    expect(enriched.product.fields.materials.source).toBe("json_ld");
    expect(enriched.product.fields.materials.value).toBe("genuine leather; Shell: 100% sheep leather; Lining: 100% recycled polyester");
    expect(enriched.product.fields.care.value).toBe("Specialist leather dry clean only");
  });

  it("stops accordion section parsing at the next product heading", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Fleece Jacket</title>
        <body>
          <main>
            <h1>Fleece Jacket</h1>
            <section class="accordion">
              Materials Body: 100% recycled polyester.
              Care Instructions Machine Wash Warm, Do Not Bleach.
              Size & Fit Regular fit.
            </section>
          </main>
        </body>
      `,
      { url: "https://shop.example/products/fleece" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);

    expect(product.fields.materials.value).toBe("Body: 100% recycled polyester");
    expect(product.fields.care.value).toBe("Machine Wash Warm, Do Not Bleach.");
    expect(product.fields.sizing.value).toEqual(["Regular fit."]);
  });

  it("normalises Stage 4 classification with controlled values and labelled inferences", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Heavy Knit Wool Blend Jumper</title>
        <script type="application/ld+json">
          {
            "@type": "Product",
            "name": "Heavy Knit Wool Blend Jumper",
            "brand": "ARKET",
            "description": "Chunky jumper knitted in a plain stitch.",
            "material": "Wool 65%, Polyamide 35%",
            "offers": {"price": "77", "priceCurrency": "GBP"}
          }
        </script>
        <body>
          <main>
            <h1>Heavy Knit Wool Blend Jumper</h1>
            <section>Product details: Construction: plain stitch.</section>
            <section>Colour: Black</section>
          </main>
        </body>
      `,
      { url: "https://www.arket.com/en_gbp/men/knitwear/product.heavy-knit-wool-blend-jumper-black.0787330025.html" }
    );

    const product = extractProductData(dom.window.document, dom.window.location);
    const classification = classifyProductEvidence(product);

    expect(classification).toMatchObject({
      category: "knitwear",
      brand: "ARKET",
      brand_tier: "mid-premium",
      price: "£77",
      material_family: "blend",
      primary_colour: "black",
      use_case: "casual",
      source_confidence_label: "high"
    });
    expect(classification.style_tags).toContain("knit");
    expect(classification.material_description).toBe("Wool 65%, Polyamide 35%.");
    expect(classification.construction_description).toContain("plain stitch");
    expect(classification.quality_concerns).toContain("inferred from material: synthetic content may affect handle or breathability");
    expect(classification.labelled_inferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "brand_tier", value: "mid-premium", basis: "inferred_from_brand" }),
        expect.objectContaining({ field: "style_tags", value: "knit" })
      ])
    );
  });

  it("keeps Stage 4 unknowns explicit when source evidence is weak", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Plain Cotton Shirt</title>
        <body>
          <h1>Plain Cotton Shirt</h1>
          <p>£39.50</p>
        </body>
      `,
      { url: "https://shop.example/products/plain-cotton-shirt" }
    );

    const classification = classifyProductEvidence(extractProductData(dom.window.document, dom.window.location));

    expect(classification.category).toBe("shirt");
    expect(classification.material_family).toBe("unknown");
    expect(classification.brand_tier).toBe("unknown");
    expect(classification.source_confidence_label).toBe("low");
    expect(classification.material_description).toBe("Material composition not clearly stated.");
    expect(classification.quality_concerns).toEqual(
      expect.arrayContaining([
        "unknown: material composition not found",
        "unknown: construction method not verified",
        "unknown: weak source data limits classification confidence"
      ])
    );
    expect(classification.labelled_inferences).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "category", value: "shirt", basis: "inferred_from_title" })])
    );
  });

  it("uses primary shell material for Stage 4 leather outerwear classification", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Miller Leather Jacket</title>
        <script type="application/ld+json">{
          "@type":"Product",
          "name":"Miller Leather Jacket",
          "brand":"AllSaints",
          "description":"Vintage motorcycle jacket.",
          "offers":{"price":"399","priceCurrency":"GBP"}
        }</script>
        <body>
          <main>
            <h1>Miller Leather Jacket</h1>
            <section>Fabric & Care Shell: 100% sheep leather. Lining: 100% recycled polyester. Specialist leather dry clean only.</section>
          </main>
        </body>
      `,
      { url: "https://www.allsaints.com/eu/men/leathers/leather-jackets/miller-leather-jacket/M009LA-5.html" }
    );

    const classification = classifyProductEvidence(extractProductData(dom.window.document, dom.window.location));

    expect(classification.category).toBe("outerwear");
    expect(classification.material_family).toBe("leather");
    expect(classification.brand_tier).toBe("premium");
    expect(classification.quality_signals).toContain(
      "inferred from material: leather can be a positive durability signal when genuine and well constructed"
    );
  });

  it("assigns more precise Stage 4 style tags across smart, smart casual, casual, and active products", () => {
    const smartSuit = new JSDOM(
      `
        <!doctype html>
        <title>Navy Slim Fit Suit Jacket</title>
        <body><main><h1>Navy Slim Fit Suit Jacket</h1><section>Product details: Tailored slim fit suit jacket.</section><p>£120</p></main></body>
      `,
      { url: "https://www.next.co.uk/style/su730732/139892" }
    );
    const oxfordShirt = new JSDOM(
      `
        <!doctype html>
        <title>Blue Oxford Shirt</title>
        <body><main><h1>Blue Oxford Shirt</h1><section>Composition: 100% cotton.</section><p>£39</p></main></body>
      `,
      { url: "https://shop.example/products/blue-oxford-shirt" }
    );
    const graphicTee = new JSDOM(
      `
        <!doctype html>
        <title>Relaxed Graphic T-Shirt</title>
        <body><main><h1>Relaxed Graphic T-Shirt</h1><section>Composition: 100% cotton.</section><p>£19</p></main></body>
      `,
      { url: "https://shop.example/products/relaxed-graphic-t-shirt" }
    );
    const runningTrainer = new JSDOM(
      `
        <!doctype html>
        <title>Performance Running Trainer</title>
        <body><main><h1>Performance Running Trainer</h1><section>Upper: synthetic mesh.</section><p>£75</p></main></body>
      `,
      { url: "https://shop.example/products/performance-running-trainer" }
    );

    const smartClassification = classifyProductEvidence(extractProductData(smartSuit.window.document, smartSuit.window.location));
    const smartCasualClassification = classifyProductEvidence(extractProductData(oxfordShirt.window.document, oxfordShirt.window.location));
    const casualClassification = classifyProductEvidence(extractProductData(graphicTee.window.document, graphicTee.window.location));
    const activeClassification = classifyProductEvidence(extractProductData(runningTrainer.window.document, runningTrainer.window.location));

    expect(smartClassification.category).toBe("outerwear");
    expect(smartClassification.style_tags).toContain("smart");
    expect(smartClassification.style_tags).not.toContain("smart casual");
    expect(smartClassification.use_case).toBe("formal / office");

    expect(smartCasualClassification.category).toBe("shirt");
    expect(smartCasualClassification.style_tags).toContain("smart casual");
    expect(smartCasualClassification.style_tags).not.toContain("smart");
    expect(smartCasualClassification.use_case).toBe("office casual");

    expect(casualClassification.style_tags).toContain("casual");
    expect(activeClassification.style_tags).toContain("active");
  });

  it("creates a bounded stage 5 backend payload with visual enrichment request metadata", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title> Test Product </title>
        <meta property="og:image" content="/product.jpg">
        <body>
          <main>
            <h1>Test Product</h1>
            <p>£39</p>
            <img src="/product-alt.jpg" width="900" height="1200" alt="Test Product">
          </main>
          ${"Visible text ".repeat(1000)}
        </body>
      `,
      { url: "https://example.com/products/test" }
    );

    const snapshot = createPageSnapshot(dom.window.document, dom.window.location);
    const payload = createBackendPayload(snapshot);

    expect(snapshot.url).toBe("https://example.com/products/test");
    expect(snapshot.title).toBe("Test Product");
    expect(snapshot.visibleText.length).toBeLessThanOrEqual(7000);
    expect(payload.extension.stage).toBe("stage_5");
    expect(payload.extension.version).toBe("0.5.0");
    expect(payload.page).toBe(snapshot);
    expect(payload.classification.source_confidence_label).toBe("low");
    expect(payload.visual_enrichment.status).toBe("requested");
    expect(payload.visual_enrichment.model).toBe("gemini-3.0-flash");
    expect(payload.visual_enrichment.fallback_model).toBe("gpt-5.4");
    expect(payload.visual_enrichment.image_urls).toEqual([
      "https://example.com/product.jpg",
      "https://example.com/product-alt.jpg"
    ]);
    expect(payload.visual_enrichment.prompt).toContain("Forbidden as hard claims");
    expect(payload.visual_enrichment.prompt).toContain("experienced personal shopper");
    expect(payload.visual_enrichment.prompt).toContain("expert_inferences");
    expect(payload.visual_enrichment.prompt).toContain("Absence of visible defects");
    expect(payload.visual_enrichment.prompt).toContain("Styling details");
  });

  it("skips Stage 5 visual enrichment when product images are missing", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <title>Plain Cotton Shirt</title>
        <body><main><h1>Plain Cotton Shirt</h1><p>£39.50</p></main></body>
      `,
      { url: "https://shop.example/products/plain-cotton-shirt" }
    );
    const snapshot = createPageSnapshot(dom.window.document, dom.window.location);
    const classification = classifyProductEvidence(snapshot.product);
    const visual = createVisualEnrichment(snapshot.product, classification);

    expect(visual.status).toBe("skipped");
    expect(visual.prompt).toBeNull();
    expect(visual.warnings).toContain("visual enrichment skipped: product images not found");
  });

  it("sanitises Stage 5 observations so image-only claims cannot affect scores strongly", () => {
    const result = sanitiseVisualObservations([
      {
        observation: "Fine-gauge texture visible in product image",
        confidence: "medium",
        evidence_type: "texture_appearance",
        should_affect_score: true
      },
      {
        observation: "The leather is genuine, durable and high quality",
        confidence: "high",
        evidence_type: "surface_detail",
        should_affect_score: true
      }
    ]);

    expect(result.observations[0]).toMatchObject({
      confidence: "medium",
      should_affect_score: true
    });
    expect(result.observations[1]).toMatchObject({
      confidence: "low",
      should_affect_score: false
    });
    expect(result.warnings).toContain("visual observation downgraded: image-only claim exceeded Stage 5 limits");
  });

  it("keeps useful but caveated expert visual inference while capping low-confidence score effects", () => {
    const result = sanitiseExpertVisualInferences([
      {
        inference: "The surface appearance may indicate a coated or heavily finished leather surface.",
        quality_dimension: "material_finish",
        confidence: "low",
        basis: "inferred_from_image",
        why_it_matters: "Heavier surface finishing can affect how leather patinates.",
        caveat: "Cannot verify leather grade from image alone.",
        score_dimension: "quality",
        score_effect: "medium_negative"
      },
      {
        inference: "The jacket is high quality and durable.",
        quality_dimension: "construction_finish",
        confidence: "high",
        basis: "inferred_from_image",
        why_it_matters: "Construction affects lifespan.",
        caveat: "No caveat.",
        score_dimension: "durability",
        score_effect: "medium_positive"
      }
    ]);

    expect(result.expert_inferences[0]).toMatchObject({
      confidence: "low",
      score_effect: "small_negative"
    });
    expect(result.expert_inferences[1]).toMatchObject({
      inference: "Image-only inference removed because it asserted quality, construction, authenticity, or durability without uncertainty.",
      confidence: "low",
      score_effect: "none"
    });
  });

  it("collects JSON-LD and image URLs from multiple source types", () => {
    const dom = new JSDOM(
      `
        <!doctype html>
        <meta property="og:image" content="/og-shirt.jpg">
        <script type="application/ld+json">[{"@type":"Product","name":"Shirt","image":{"url":"/json-shirt.jpg"}}]</script>
        <body><main><img src="/dom-shirt.jpg" width="800" height="1000" alt="Product image"><img src="/logo.svg" width="80" height="40" alt="Logo"></main></body>
      `,
      { url: "https://shop.example/products/shirt" }
    );

    const jsonLd = collectJsonLd(dom.window.document);
    const images = collectImageUrls(dom.window.document, dom.window.location, jsonLd, collectMetaTags(dom.window.document));

    expect(jsonLd).toHaveLength(1);
    expect(images).toEqual([
      "https://shop.example/json-shirt.jpg",
      "https://shop.example/og-shirt.jpg",
      "https://shop.example/dom-shirt.jpg"
    ]);
  });

  it("recovers blocked H&M product data from first-party tag JSON", async () => {
    const dom = new JSDOM(
      "<!doctype html><title>Access Denied</title><body>Access denied. Request blocked.</body>",
      { url: "https://www2.hm.com/en_gb/productpage.0570002002.html" }
    );
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          ProductNameLong: "Slim Fit Round-necked T-shirt",
          ProductNameShort: "T-shirt",
          ProductCareInstructionsWashing: "machinewash40",
          ProductCustomerGroup: "man",
          ProductAssortmentType: "clothing",
          ProductPresentationProductType: "tshirt",
          ProductStyle: "roundneck",
          ProductFit: "slimfit",
          ProductDescriptiveLength: "regularlength,shortsleeve",
          ArticlePresentationColorGroup: "white"
        })
      );

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("Slim Fit Round-necked T-shirt");
    expect(snapshot.product.fields.brand.value).toBe("H&M");
    expect(snapshot.product.fields.care.value).toBe("Machine wash at 40C");
    expect(snapshot.product.fields.colour.value).toBe("White");
    expect(snapshot.product.fields.sizing.value).toEqual(["Slim Fit", "Round Neck", "Regular Length", "Short Sleeve"]);
    expect(snapshot.product.fields.categoryBreadcrumbs.value).toEqual(["man", "clothing", "tshirt"]);
    expect(snapshot.product.warnings[0]).toContain("H&M first-party tag data");
  });

  it("recovers UNIQLO product data from first-party preloaded state without DOM sizing noise", async () => {
    const dom = new JSDOM("<!doctype html><title>UNIQLO</title><body>Loading</body>", {
      url: "https://www.uniqlo.com/uk/en/products/E450535-000/00?colorDisplayCode=69&sizeDisplayCode=003"
    });
    const fetcher = async () =>
      new Response(`
        <script>
          window.__PRELOADED_STATE__ = {"product":{"details":{
            "breadcrumbs":{"gender":{"locale":"MEN"},"class":{"locale":"Knitwear"},"category":{"locale":"Jumpers & Cardigans"},"subcategory":{"locale":"Crew Neck"}},
            "name":"100% Merino Crew Neck Jumper",
            "productId":"E450535-000",
            "composition":"100% Wool",
            "longDescription":"- Machine-washable.",
            "freeInformation":"Wool is a natural material.",
            "washingInformation":"Machine wash up to 40 degrees, gentle cycle, Dry Clean, Not suitable for tumble-drying.",
            "prices":{"base":{"value":34.9,"currency":{"code":"GBP","symbol":"£"}}},
            "representative":{"color":{"displayCode":"69","name":"NAVY"}},
            "images":{"main":{"69":"https://image.uniqlo.com/main.jpg"},"sub":{"69":["https://image.uniqlo.com/sub.jpg"]}}
          }}}
        </script>
      `);

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.fields.title.value).toBe("100% Merino Crew Neck Jumper");
    expect(snapshot.product.fields.brand.value).toBe("UNIQLO");
    expect(snapshot.product.fields.price.value).toBe("34.9");
    expect(snapshot.product.fields.currency.value).toBe("GBP");
    expect(snapshot.product.fields.colour.value).toBe("NAVY");
    expect(snapshot.product.fields.materials.value).toBe("100% Wool; title states Merino");
    expect(snapshot.product.fields.care.value).toContain("Machine wash up to 40 degrees");
    expect(snapshot.product.fields.sizing.value).toBeNull();
    expect(snapshot.product.imageUrls).toEqual(["https://image.uniqlo.com/main.jpg", "https://image.uniqlo.com/sub.jpg"]);
  });

  it("recovers blocked Zara product data from first-party reference JSON", async () => {
    const dom = new JSDOM(
      "<!doctype html><title>Access Denied</title><body>Access denied. Request blocked.</body>",
      { url: "https://www.zara.com/uk/en/cotton---linen-shirt-p01063412.html" }
    );
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          status: "SUCCESS",
          results: [
            {
              content: {
                name: "COTTON - LINEN SHIRT",
                price: 3599,
                sectionName: "MAN",
                familyName: "CAMISA",
                subfamilyName: "Camis AV M/L",
                detail: {
                  colors: [
                    {
                      name: "Olive green",
                      price: 3599,
                      xmedia: [{ url: "https://static.zara.net/assets/public/example/01063412515-f1.jpg?ts=1&w={width}" }]
                    }
                  ]
                }
              }
            }
          ]
        })
      );

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("COTTON - LINEN SHIRT");
    expect(snapshot.product.fields.brand.value).toBe("Zara");
    expect(snapshot.product.fields.price.value).toBe("35.99");
    expect(snapshot.product.fields.currency.value).toBe("GBP");
    expect(snapshot.product.imageUrls).toEqual(["https://static.zara.net/assets/public/example/01063412515-f1.jpg?ts=1&w=1024"]);
    expect(snapshot.product.warnings[0]).toContain("Zara first-party reference data");
  });

  it("recovers Patagonia failover pages by fetching first-party product HTML", async () => {
    const dom = new JSDOM(
      "<!doctype html><title>Hang Tight! Routing to checkout...</title><body>Hang Tight! Routing to checkout...</body>",
      { url: "https://www.patagonia.com/product/mens-micro-d-fleece-jacket/26171.html" }
    );
    const fetcher = async () =>
      new Response(`
        <!doctype html>
        <script type="application/ld+json">
          [{
            "@context":"https://schema.org/",
            "@type":"ProductGroup",
            "name":"Men's Micro D® Fleece Jacket",
            "description":"Built from 100% recycled polyester microdenier fleece.",
            "image":"https://www.patagonia.com/images/26171.jpg",
            "brand":{"@type":"Brand","name":"Patagonia"}
          },{
            "@context":"https://schema.org",
            "@type":"Product",
            "name":"Men's Aquatic Blue Micro D® Fleece Jacket",
            "offers":{"@type":"Offer","price":"99","priceCurrency":"USD"}
          }]
        </script>
        <div class="accordion-group" data-pdp-accordion-fit>
          <div class="accordion-content"><ul><li><p>Regular fit</p></li></ul></div>
        </div>
        <div class="accordion-group" data-pdp-accordion-materials>
          <div class="accordion-content"><ul>
            <li><h3>Body</h3><p>4.7-oz 100% recycled polyester microdenier fleece</p></li>
            <li><h3>Care Instructions</h3><p>Machine Wash Warm, Do Not Bleach, Tumble Dry Low</p></li>
          </ul></div>
        </div>
        <div class="pdp-ser-wrapper"></div>
      `);

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("Men's Micro D® Fleece Jacket");
    expect(snapshot.product.fields.brand.value).toBe("Patagonia");
    expect(snapshot.product.fields.price.value).toBe("99");
    expect(snapshot.product.fields.currency.value).toBe("USD");
    expect(snapshot.product.fields.materials.value).toContain("Body: 4.7-oz 100% recycled polyester microdenier fleece");
    expect(snapshot.product.fields.care.value).toBe("Machine Wash Warm, Do Not Bleach, Tumble Dry Low");
    expect(snapshot.product.fields.sizing.value).toBe("Regular fit");
    expect(snapshot.product.imageUrls).toEqual(["https://www.patagonia.com/images/26171.jpg"]);
    expect(snapshot.product.warnings[0]).toContain("Patagonia first-party product HTML");
  });

  it("enriches M&S products with currency, colour, and fit from page data", async () => {
    const dom = new JSDOM("<!doctype html><title>M&S</title><body>Loading</body>", {
      url: "https://www.marksandspencer.com/leather-lace-up-trainers/p/clp60642209"
    });
    const fetcher = async () =>
      new Response(`
        <!doctype html>
        <title>Leather Lace Up Performance Trainers with Freshfeet™ | Autograph | M&S</title>
        <meta name="description" content="These genuine leather trainers deliver minimalist style. Cut to a regular fit with smooth cupsoles.">
        <script type="application/ld+json">{
          "@type":"Product",
          "name":"Leather Lace Up Performance Trainers with Freshfeet™",
          "brand":{"@type":"Brand","name":"Autograph"},
          "description":"These genuine leather trainers deliver minimalist style. Cut to a regular fit with smooth cupsoles.",
          "offers":{"@type":"Offer","price":"70"}
        }</script>
        <label aria-label="BLACK colour option"><input type="radio" name="colour" checked></label>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"product":{"price":{"currencyCode":"GBP"}}}}</script>
      `);

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.fields.title.value).toBe("Leather Lace Up Performance Trainers with Freshfeet™");
    expect(snapshot.product.fields.brand.value).toBe("Autograph");
    expect(snapshot.product.fields.price.value).toBe("70");
    expect(snapshot.product.fields.currency.value).toBe("GBP");
    expect(snapshot.product.fields.colour.value).toBe("Black");
    expect(snapshot.product.fields.materials.value).toBe("genuine leather");
    expect(snapshot.product.fields.sizing.value).toBe("Regular Fit");
  });

  it("recovers ARKET product data from first-party Next.js payloads", async () => {
    const dom = new JSDOM("<!doctype html><title>Access denied</title><body>Access denied</body>", {
      url: "https://www.arket.com/en_gbp/men/knitwear/product.heavy-knit-wool-blend-jumper-black.0787330025.html"
    });
    const fetcher = async () =>
      new Response(`
        <script id="__NEXT_DATA__" type="application/json">
          {"props":{"pageProps":{"blocks":[{"product":{
            "defaultName":"Heavy Knit Wool Blend Jumper",
            "brandName":"ARKET",
            "priceAsNumber":77,
            "description":"Chunky jumper knitted in a plain stitch.",
            "var_material_composition_desc":"[{\\"type\\":null,\\"materials\\":[{\\"material\\":\\"Polyamide\\",\\"percentage\\":35},{\\"material\\":\\"Wool\\",\\"percentage\\":65}]}]",
            "var_care_instruction":["Dry clean","Hand wash cold"],
            "pr_fit":"Oversized",
            "pr_product_type_name":"Jumper",
            "categoryName":["men","knitwear"],
            "media":{"standard":["https://arket.example/jumper.jpg"]}
          }}]}}}
        </script>
      `);

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("Heavy Knit Wool Blend Jumper");
    expect(snapshot.product.fields.brand.value).toBe("ARKET");
    expect(snapshot.product.fields.price.value).toBe("77");
    expect(snapshot.product.fields.materials.value).toBe("Polyamide 35%, Wool 65%");
    expect(snapshot.product.fields.care.value).toBe("Dry clean, Hand wash cold");
    expect(snapshot.product.imageUrls).toEqual(["https://arket.example/jumper.jpg"]);
  });

  it("recovers AllSaints product data from first-party product HTML", async () => {
    const dom = new JSDOM("<!doctype html><title>Access denied</title><body>Access denied</body>", {
      url: "https://www.allsaints.com/eu/men/leathers/leather-jackets/miller-leather-jacket/M009LA-5.html"
    });
    const fetcher = async () =>
      new Response(`
        <script type="application/ld+json">{"@type":"WebPage","headline":"Miller Leather Jacket","description":"Miller leather jacket."}</script>
        <section data-analytics="{&quot;id&quot;:&quot;M009LA-5&quot;,&quot;name&quot;:&quot;Miller Leather Jacket&quot;,&quot;category&quot;:&quot;Leather Jackets&quot;,&quot;currency&quot;:&quot;EUR&quot;,&quot;price&quot;:&quot;499.00&quot;,&quot;imageURL&quot;:&quot;https://media.example/M009LA-5-1&quot;}"></section>
        <span data-ref="disclosureContent">Vintage motorcycle jackets inspired this style. Zip closure. Full collar. Long sleeves.</span>
        <div class="b-header_product-name b-header_fabric_care-title">FABRIC &amp; CARE:</div>
        <div class="b-pdp_user_content"><ul><li>Shell: 100% sheep leather</li><li>Lining: 100% recycled polyester</li><li>Specialist leather dry clean only</li></ul></div>
        <div class="b-pdp_user_content">Made in: India</div>
        <p>Product ID: <span data-tau="product_details_id">M009LA-5</span></p>
      `);

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("Miller Leather Jacket");
    expect(snapshot.product.fields.brand.value).toBe("AllSaints");
    expect(snapshot.product.fields.price.value).toBe("499.00");
    expect(snapshot.product.fields.materials.value).toContain("100% sheep leather");
    expect(snapshot.product.fields.care.value).toBe("Specialist leather dry clean only");
    expect(snapshot.product.imageUrls).toEqual(["https://media.example/M009LA-5-1"]);
  });

  it("recovers exact Next products from first-party Bloomreach catalog data", async () => {
    const dom = new JSDOM("<!doctype html><title>Access denied</title><body>Access denied</body>", {
      url: "https://www.next.co.uk/style/st038974/u16233"
    });
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          response: {
            docs: [
              {
                pid: "U16233",
                title: "moss neutral slim fit suit jacket",
                brand: "moss",
                price: 129,
                sale_price: 129,
                url: "https://www.next.co.uk/style/ST038974/U16233#U16233",
                description: "blended with 66% recycled fibres, moss' slim-fit suit takes a more sustainable approach.",
                next_category: ["suitjackets"],
                thumb_image: "https://xcdn.next.co.uk/common/items/default/default/itemimages/3_4Ratio/Product_SIP/Lge/U16233.jpg"
              }
            ]
          }
        })
      );

    const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetcher);

    expect(snapshot.product.pageState).toBe("product_page");
    expect(snapshot.product.fields.title.value).toBe("Moss Neutral Slim Fit Suit Jacket");
    expect(snapshot.product.fields.brand.value).toBe("Moss");
    expect(snapshot.product.fields.price.value).toBe("129");
    expect(snapshot.product.fields.currency.value).toBe("GBP");
    expect(snapshot.product.fields.materials.value).toBe("66% recycled fibres");
    expect(snapshot.product.fields.colour.value).toBe("Neutral");
    expect(snapshot.product.imageUrls).toHaveLength(1);
  });
});
