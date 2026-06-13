import { z } from 'zod';

export const ToolName = 'classify_type_b' as const;
export const TOOL_VERSION = '0.1.0';

export const ClassifyTypeBInputSchema = z.object({
  line_id: z.string(),
  description: z.string()
});

export const ClassifyTypeBOutputSchema = z.object({
  line_id: z.string(),
  type_b: z.enum(['INSPECTION', 'CUSTOMS', 'DO', 'INLAND', 'THC', 'DETENTION', 'STROAGE', 'OTHERS']),
  confidence: z.number(),
  matched_keyword: z.string().nullable()
});

export type ClassifyTypeBInput = z.infer<typeof ClassifyTypeBInputSchema>;
export type ClassifyTypeBOutput = z.infer<typeof ClassifyTypeBOutputSchema>;

const RULES: Array<{ category: ClassifyTypeBOutput['type_b']; keywords: string[] }> = [
  {
    category: 'INSPECTION',
    keywords: ['customs inspection', 'inspection by customs', 'customs inspection fee']
  },
  {
    category: 'CUSTOMS',
    keywords: [
      'customs clearance', 'bill of entry', 'boe', 'customs duty',
      'export customs', 'import customs', 'customs documentation',
      'shj customs', 'code opening', 'customs gate pass'
    ]
  },
  {
    category: 'DO',
    keywords: ['master do', 'house do', 'delivery order', 'do fee', 'document delivery order']
  },
  {
    category: 'INLAND',
    keywords: [
      'transport', 'truck', 'trucking', 'inland',
      'fb from', 'cipca', 'mosb', 'road freight', 'appointment charge'
    ]
  },
  {
    category: 'THC',
    keywords: [
      'terminal handling', 'port handling', 'thc', 'tsc',
      'discharging', 'loading', 'unloading', 'berth', 'stevedoring'
    ]
  },
  {
    category: 'DETENTION',
    keywords: ['container detention', 'line detention', 'detention']
  },
  {
    category: 'STROAGE',
    keywords: ['warehouse storage', 'yard storage', 'port storage', 'storage', 'stroage']
  }
];

export async function run(input: ClassifyTypeBInput): Promise<ClassifyTypeBOutput> {
  const normalized = input.description.toLowerCase();

  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword)) {
        const isExact = normalized === keyword || normalized.split(/\s+/).some((w) => w === keyword);
        return {
          line_id: input.line_id,
          type_b: rule.category,
          confidence: isExact ? 0.95 : 0.85,
          matched_keyword: keyword
        };
      }
    }
  }

  return {
    line_id: input.line_id,
    type_b: 'OTHERS',
    confidence: 0.5,
    matched_keyword: null
  };
}
