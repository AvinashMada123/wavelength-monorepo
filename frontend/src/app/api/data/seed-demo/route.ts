import { NextRequest, NextResponse } from "next/server";
import { requireUidAndOrg, query } from "@/lib/db";

const PERSONAS = [
  {
    name: "The Busy Professional",
    content:
      "This person is time-constrained, values efficiency, and needs to see immediate ROI. They respond well to concise value propositions and concrete outcomes. Avoid lengthy explanations — get to the point fast. Emphasize how AI saves them 10-15 hours/week on repetitive tasks.",
    keywords: ["busy", "no time", "quick", "schedule", "meeting", "deadline", "work"],
    phrases: [
      "I understand you're busy, so I'll keep this brief.",
      "This is exactly designed for professionals like you who need results fast.",
      "Most of our members save 10+ hours a week after implementing what they learn.",
    ],
  },
  {
    name: "The Curious Learner",
    content:
      "This person is genuinely interested in AI and wants to understand the technology. They ask detailed questions and enjoy learning. Engage with their curiosity, share specific examples, and go deeper when they show interest. They are likely to convert if they feel the masterclass offers real depth.",
    keywords: ["how", "what", "explain", "learn", "understand", "technology", "curious", "interesting"],
    phrases: [
      "Great question! Let me walk you through how that works.",
      "You'll love the hands-on sessions where you actually build AI workflows.",
      "The masterclass covers everything from fundamentals to advanced automation.",
    ],
  },
  {
    name: "The Skeptic",
    content:
      "This person doubts whether AI is relevant to them or whether the masterclass delivers real value. They may have seen too many 'get rich quick' pitches. Be authentic, share verifiable results, and avoid hype. Use specific numbers and real case studies to build credibility.",
    keywords: ["scam", "really", "prove", "doubt", "skeptical", "waste", "another", "guarantee"],
    phrases: [
      "I completely understand your hesitation — let me share some real results.",
      "We've had over 5,000 professionals go through this, and here's what they achieved.",
      "There's no magic here — just practical AI skills that companies are paying premium for.",
    ],
  },
  {
    name: "The Decision Maker",
    content:
      "This person needs to justify the investment — either to themselves or their organization. They think in terms of business outcomes, team productivity, and competitive advantage. Speak their language: ROI, scalability, team upskilling, market positioning.",
    keywords: ["cost", "investment", "team", "company", "budget", "worth", "return", "benefit"],
    phrases: [
      "Companies that adopt AI early are seeing 3-5x productivity gains.",
      "This masterclass has been adopted by teams at TCS, Infosys, and several startups.",
      "The investment pays for itself within the first project you automate.",
    ],
  },
];

const SITUATIONS = [
  {
    name: "Price Objection",
    content:
      "The prospect is hesitant about the price. Acknowledge their concern, then reframe the cost as an investment. Compare it to the cost of NOT learning AI (falling behind competitors, spending hours on manual tasks). Offer flexible payment options if available.",
    keywords: ["expensive", "cost", "price", "afford", "cheap", "money", "free"],
    hint: "Reframe price as investment, compare to cost of inaction",
  },
  {
    name: "Already Knows AI",
    content:
      "The prospect claims they already know AI or use ChatGPT. Acknowledge their knowledge, then differentiate the masterclass — it's about building production-ready AI workflows, not just prompting. Emphasize automation, integration with business tools, and building AI agents.",
    keywords: ["already know", "chatgpt", "use ai", "know ai", "tried", "already using"],
    hint: "Differentiate: prompting vs building real AI workflows",
  },
  {
    name: "Need to Consult Someone",
    content:
      "The prospect needs to check with a spouse, manager, or partner. Respect their process but create gentle urgency. Offer to send detailed information they can share. Suggest a follow-up call at a specific time.",
    keywords: ["husband", "wife", "boss", "manager", "partner", "consult", "ask", "check with"],
    hint: "Respect their process, offer shareable info, set follow-up",
  },
];

const PRODUCT_SECTIONS = [
  { name: "AI Masterclass Overview", content: "The Freedom with AI Masterclass is an intensive, hands-on program designed for professionals, entrepreneurs, and business owners who want to leverage AI to 10x their productivity. Over 3 days, participants learn to build AI-powered automation workflows, create intelligent chatbots, set up AI calling systems, and integrate AI into their existing business processes. No coding experience required — we use no-code and low-code tools that anyone can master.", keywords: ["masterclass", "program", "course", "what is", "about", "overview"] },
  { name: "Key Features & Curriculum", content: "Day 1: AI Foundations & Prompt Engineering — Master advanced prompting, learn to use Claude, GPT-4, and Gemini effectively. Day 2: AI Automation & Workflows — Build end-to-end automation using n8n, Make.com, and Zapier. Create AI agents that handle customer support, lead qualification, and data processing. Day 3: AI Business Integration — Set up AI calling systems, WhatsApp automation, CRM integration, and AI-powered analytics dashboards. Bonus: Access to our private community, 50+ pre-built AI workflow templates, and 6 months of mentorship.", keywords: ["curriculum", "learn", "topics", "features", "what will", "schedule", "days"] },
  { name: "Pricing & Plans", content: "Standard Access: Rs 4,999 — Includes all 3 days of live training, recordings, and community access. Premium Access: Rs 9,999 — Everything in Standard plus 1-on-1 mentorship sessions, premium templates, and priority support. Enterprise: Custom pricing — Team licenses for 5+ members, custom workshops, and dedicated account manager. Early bird discount of 30% available for registrations made 7+ days before the event.", keywords: ["price", "cost", "how much", "fee", "payment", "discount", "offer", "plan"] },
  { name: "Benefits & Outcomes", content: "After completing the masterclass, participants can: automate 60-80% of repetitive business tasks, build AI chatbots for customer support in under 2 hours, set up AI-powered calling systems for sales and follow-ups, create content 10x faster using AI workflows, qualify and nurture leads automatically. Average participant reports saving 12 hours/week within the first month of implementation.", keywords: ["benefit", "outcome", "result", "what do i get", "after", "achieve", "gain"] },
  { name: "Testimonials & Success Stories", content: "Rajesh K., Startup Founder: 'Automated my entire lead follow-up process. Went from 20 calls/day manually to 200 AI-powered calls. Revenue up 340% in 3 months.' Priya M., Marketing Manager: 'Built an AI content pipeline that produces a week's worth of social media content in 30 minutes. My team now focuses on strategy instead of execution.' Suresh B., Freelancer: 'Started offering AI automation services to clients. Went from Rs 50K/month to Rs 3L/month within 4 months of completing the masterclass.'", keywords: ["testimonial", "review", "success", "story", "result", "who has", "others"] },
  { name: "Objection Handling - Common Concerns", content: "\"I'm not technical\" — 90% of our participants have zero coding background. We use drag-and-drop tools. \"I don't have time\" — The masterclass is 3 days, and the skills save you 10+ hours every week going forward. \"Is AI just hype?\" — Companies using AI are growing 2-5x faster than competitors. McKinsey estimates AI will add $13 trillion to the global economy by 2030. \"Can I learn this from YouTube?\" — You can learn basics, but our masterclass gives you implementation frameworks, live support, and proven templates that save months of trial and error.", keywords: ["concern", "but", "worry", "objection", "hesitation", "doubt"] },
];

const SOCIAL_PROOF_COMPANIES = [
  { companyName: "TCS", enrollmentsCount: 45, notableOutcomes: "Automated internal HR processes, saving 2000+ hours/quarter", trending: true },
  { companyName: "Infosys", enrollmentsCount: 38, notableOutcomes: "Built AI-powered client onboarding system", trending: false },
  { companyName: "Wipro", enrollmentsCount: 27, notableOutcomes: "Deployed AI chatbots across 3 business units", trending: false },
  { companyName: "Razorpay", enrollmentsCount: 12, notableOutcomes: "AI-driven fraud detection prototype built during masterclass", trending: true },
  { companyName: "Zoho", enrollmentsCount: 20, notableOutcomes: "Integrated AI workflows into existing Zoho ecosystem", trending: false },
  { companyName: "Swiggy", enrollmentsCount: 8, notableOutcomes: "Automated vendor communication and support ticketing", trending: true },
  { companyName: "Freshworks", enrollmentsCount: 15, notableOutcomes: "Built AI customer sentiment analysis pipeline", trending: false },
  { companyName: "PhonePe", enrollmentsCount: 10, notableOutcomes: "AI-powered internal knowledge base and support bot", trending: false },
];

const SOCIAL_PROOF_CITIES = [
  { cityName: "Hyderabad", enrollmentsCount: 850, trending: true },
  { cityName: "Bangalore", enrollmentsCount: 720, trending: true },
  { cityName: "Mumbai", enrollmentsCount: 530, trending: false },
  { cityName: "Delhi NCR", enrollmentsCount: 480, trending: false },
  { cityName: "Chennai", enrollmentsCount: 310, trending: true },
  { cityName: "Pune", enrollmentsCount: 290, trending: false },
  { cityName: "Kolkata", enrollmentsCount: 180, trending: false },
  { cityName: "Ahmedabad", enrollmentsCount: 150, trending: false },
  { cityName: "Jaipur", enrollmentsCount: 95, trending: true },
  { cityName: "Kochi", enrollmentsCount: 85, trending: false },
];

const SOCIAL_PROOF_ROLES = [
  { roleName: "Software Engineer", enrollmentsCount: 620, successStories: "Engineers are building AI copilots for their dev workflows, cutting code review time by 40%" },
  { roleName: "Business Owner", enrollmentsCount: 480, successStories: "Owners automating customer follow-ups, invoicing, and lead qualification — saving 15+ hours/week" },
  { roleName: "Marketing Manager", enrollmentsCount: 350, successStories: "Marketers generating month's content in a day using AI pipelines and automated social scheduling" },
  { roleName: "Freelancer", enrollmentsCount: 290, successStories: "Freelancers adding AI automation as a service, doubling their monthly revenue within 3 months" },
  { roleName: "Student", enrollmentsCount: 410, successStories: "Students landing AI-related internships and building portfolio projects that stand out" },
  { roleName: "HR Professional", enrollmentsCount: 120, successStories: "HR teams automating resume screening, interview scheduling, and employee onboarding" },
  { roleName: "Sales Executive", enrollmentsCount: 200, successStories: "Sales teams using AI calling and lead scoring to increase conversion rates by 60%" },
];

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireUidAndOrg(request);
    
    let totalSeeded = 0;

    // Seed Personas
    for (const persona of PERSONAS) {
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO personas (id, org_id, name, content, keywords, phrases, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [id, orgId, persona.name, persona.content, JSON.stringify(persona.keywords), JSON.stringify(persona.phrases)]
      );
      totalSeeded++;
    }

    // Seed Situations
    for (const situation of SITUATIONS) {
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO situations (id, org_id, name, content, keywords, hint, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [id, orgId, situation.name, situation.content, JSON.stringify(situation.keywords), situation.hint]
      );
      totalSeeded++;
    }
    console.log(`[Seed] Seeded ${PERSONAS.length} personas + ${SITUATIONS.length} situations`);

    // Seed Product Sections
    for (const section of PRODUCT_SECTIONS) {
      const id = crypto.randomUUID();
      await query(
        `INSERT INTO product_sections (id, org_id, name, content, keywords, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [id, orgId, section.name, section.content, JSON.stringify(section.keywords)]
      );
      totalSeeded++;
    }
    console.log(`[Seed] Seeded ${PRODUCT_SECTIONS.length} product sections`);

    // Seed Social Proof
    for (let i = 0; i < SOCIAL_PROOF_COMPANIES.length; i++) {
      const c = SOCIAL_PROOF_COMPANIES[i];
      await query(
        `INSERT INTO ui_social_proof_companies (id, org_id, company_name, enrollments_count, notable_outcomes, trending, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [`company_${i + 1}`, orgId, c.companyName, c.enrollmentsCount, c.notableOutcomes, c.trending]
      );
      totalSeeded++;
    }
    for (let i = 0; i < SOCIAL_PROOF_CITIES.length; i++) {
      const c = SOCIAL_PROOF_CITIES[i];
      await query(
        `INSERT INTO ui_social_proof_cities (id, org_id, city_name, enrollments_count, trending, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`city_${i + 1}`, orgId, c.cityName, c.enrollmentsCount, c.trending]
      );
      totalSeeded++;
    }
    for (let i = 0; i < SOCIAL_PROOF_ROLES.length; i++) {
      const r = SOCIAL_PROOF_ROLES[i];
      await query(
        `INSERT INTO ui_social_proof_roles (id, org_id, role_name, enrollments_count, success_stories, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`role_${i + 1}`, orgId, r.roleName, r.enrollmentsCount, r.successStories]
      );
      totalSeeded++;
    }
    console.log(`[Seed] Seeded ${SOCIAL_PROOF_COMPANIES.length} companies, ${SOCIAL_PROOF_CITIES.length} cities, ${SOCIAL_PROOF_ROLES.length} roles`);

    return NextResponse.json({
      success: true,
      seeded: {
        personas: PERSONAS.length,
        situations: SITUATIONS.length,
        productSections: PRODUCT_SECTIONS.length,
        companies: SOCIAL_PROOF_COMPANIES.length,
        cities: SOCIAL_PROOF_CITIES.length,
        roles: SOCIAL_PROOF_ROLES.length,
        total: totalSeeded,
      },
    });
  } catch (error) {
    console.error("[Seed] Error:", error);
    return NextResponse.json({ success: false, message: String(error) }, { status: 500 });
  }
}
