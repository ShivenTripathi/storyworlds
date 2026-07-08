export interface MeResponse {
  user: {
    email: string;
  };
  plan: {
    name: string;
    isFree: boolean;
  };
  todayUsage: {
    uploads: number;
    chats: number;
  };
  limits: {
    uploads: number;
    chats: number;
  };
}

export interface CheckoutResponse {
  url: string;
}
