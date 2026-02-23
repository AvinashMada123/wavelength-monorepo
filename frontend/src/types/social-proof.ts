export interface SocialProofCompany {
  id: string;
  companyName: string;
  enrollmentsCount: number;
  notableOutcomes?: string;
  trending?: boolean;
}

export interface SocialProofCity {
  id: string;
  cityName: string;
  enrollmentsCount: number;
  trending?: boolean;
}

export interface SocialProofRole {
  id: string;
  roleName: string;
  enrollmentsCount: number;
  successStories?: string;
}
