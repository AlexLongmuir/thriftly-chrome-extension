import { JSDOM } from "jsdom";
import { createPageSnapshotWithRetailerFallbacks } from "../src/shared/retailerFallbacks";

const URLS = [
  "https://www.uniqlo.com/uk/en/products/E450535-000/00",
  "https://www.arket.com/en_gbp/men/knitwear/product.fine-knit-merino-jumper-black.0490418001.html",
  "https://www.arket.com/en_gbp/men/knitwear/product.heavy-knit-wool-blend-jumper-black.0787330025.html",
  "https://www.mrporter.com/en-gb/mens/product/mr-p/clothing/crew-necks/brushed-cashmere-sweater/46376663162905192",
  "https://www.mrporter.com/en-gb/mens/product/celine/clothing/crew-necks/cashmere-sweater/1647597323606986",
  "https://www2.hm.com/en_gb/productpage.0570002002.html",
  "https://www2.hm.com/en_gb/productpage.1101074001.html",
  "https://www2.hm.com/en_gb/productpage.0945531001.html",
  "https://www.zara.com/uk/en/cotton---linen-shirt-p01063412.html",
  "https://www.zara.com/uk/en/linen-cotton-polo-shirt-p01063304.html",
  "https://www.next.co.uk/style/su730732/139892",
  "https://www.next.co.uk/style/st117534/402122",
  "https://www.next.co.uk/style/st038974/u16233",
  "https://www.marksandspencer.com/leather-lace-up-trainers/p/clp60642209",
  "https://www.marksandspencer.com/leather-trainers/p/clp60720372",
  "https://www.allsaints.com/eu/men/leathers/leather-jackets/alkan-zip-up-two-tone-leather-jacket/M018LB-839.html",
  "https://www.allsaints.com/eu/men/leathers/leather-jackets/miller-leather-jacket/M009LA-5.html",
  "https://www.patagonia.com/product/mens-micro-d-fleece-jacket/26171.html",
  "https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html",
  "https://www.patagonia.com/product/mens-reclaimed-fleece-jacket/22921.html"
];

const fieldNames = ["title", "brand", "price", "currency", "colour", "materials", "care", "construction", "origin", "sizing"] as const;

for (const url of URLS) {
  const response = await fetch(url, { redirect: "follow" });
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const snapshot = await createPageSnapshotWithRetailerFallbacks(dom.window.document, dom.window.location, fetch);
  const product = snapshot.product;
  const fields = Object.fromEntries(
    fieldNames.map((field) => [
      field,
      {
        value: product.fields[field].value,
        confidence: product.fields[field].confidence,
        source: product.fields[field].source
      }
    ])
  );

  console.log(
    JSON.stringify({
      url,
      httpStatus: response.status,
      pageState: product.pageState,
      sourceMethod: product.sourceMethod,
      sourceConfidenceScore: product.sourceConfidenceScore,
      fields,
      imageCount: product.imageUrls.length,
      warnings: product.warnings
    })
  );
}
