export interface ProductSection {
  id: string;
  name: string;
  content: string;
  keywords: string[];
  updatedAt: string;
}

export const PRODUCT_SECTION_TYPES = [
  "overview",
  "features",
  "pricing",
  "benefits",
  "testimonials",
  "objection_handling",
  "comparison",
] as const;
