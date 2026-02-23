export interface Persona {
  id: string;
  name: string;
  content: string;
  keywords: string[];
  phrases: string[];
  updatedAt: string;
}

export interface Situation {
  id: string;
  name: string;
  content: string;
  keywords: string[];
  hint: string;
  updatedAt: string;
}
